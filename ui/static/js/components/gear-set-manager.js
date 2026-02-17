/**
 * GearSetManager Component
 * 
 * Manages gear set naming, saving, loading, and deletion.
 * 
 * Features:
 * - Save button (enabled when name AND (gear OR name changed))
 * - Text input with placeholder "New Gear Set"
 * - Dropdown with search, "+ New Gear Set", saved gear sets list
 * - Two-click delete confirmation
 * - Arrow toggle (▶/▼)
 * - Toast notifications on create/edit/delete
 * 
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.12, 1.13
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import KeyboardNavigator from '../utils/keyboard-navigation.js';

class GearSetManager extends Component {
    /**
     * Create a gear set manager
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // Track current state for change detection
        this.currentGearSetId = null;  // null = new/unsaved
        this.originalName = '';
        this.originalGear = {};

        // UI state
        this.dropdownOpen = false;
        this.searchText = '';
        this.pendingDelete = null;  // ID of gear set pending deletion

        // Keyboard navigation
        this.keyboardNav = null;

        // Subscribe to gear set state changes
        this.subscribe('gearsets.selectedId', () => this.onSelectionChange());
        this.subscribe('gearsets.selectedName', () => {
            // Preserve dropdown state when name changes
            if (this.dropdownOpen) {
                const $nameInput = this.$element.find('.gear-set-name-input');
                if ($nameInput.length) {
                    $nameInput.val(store.state.gearsets.selectedName || '');
                }
                this.updateSaveButtonState();
            } else {
                this.render();
            }
        });
        this.subscribe('gearsets.current', () => this.render());
        this.subscribe('gearsets.saved', () => {
            // When saved gearsets change (add/delete), preserve dropdown state
            if (this.dropdownOpen) {
                this.renderPreservingScroll();
            } else {
                this.render();
            }
        });

        this.render();
        this.attachEvents();
    }

    /**
     * Handle selection change - update tracking state
     */
    onSelectionChange() {
        const selectedId = store.state.gearsets.selectedId;
        const selectedName = store.state.gearsets.selectedName;

        this.currentGearSetId = selectedId;
        this.originalName = selectedName;

        // Deep copy current gear for comparison
        this.originalGear = JSON.parse(JSON.stringify(store.state.gearsets.current));

        // Preserve dropdown state when selection changes
        if (this.dropdownOpen) {
            // Only update the name input and save button, keep dropdown open
            const $nameInput = this.$element.find('.gear-set-name-input');
            if ($nameInput.length) {
                $nameInput.val(selectedName);
            }
            this.updateSaveButtonState();
        } else {
            this.render();
        }
    }

    /**
     * Check if there are unsaved changes
     * Requirements: 1.13
     * 
     * @returns {boolean} True if name or gear has changed
     */
    hasChanges() {
        const currentName = store.state.gearsets.selectedName || '';
        const currentGear = store.state.gearsets.current;

        // Check if name changed
        const nameChanged = currentName !== this.originalName;

        // Check if gear changed (deep comparison)
        const gearChanged = JSON.stringify(currentGear) !== JSON.stringify(this.originalGear);

        return nameChanged || gearChanged;
    }

    /**
     * Check if save button should be enabled
     * Requirements: 1.13
     * 
     * @returns {boolean} True if save button should be enabled
     */
    canSave() {
        const currentName = store.state.gearsets.selectedName || '';

        // Must have a name AND have changes
        return currentName.trim().length > 0 && this.hasChanges();
    }

    /**
     * Save current gear set
     * Requirements: 1.9
     */
    async save() {
        const name = store.state.gearsets.selectedName.trim();

        if (!name) {
            api.showError('Please enter a gear set name');
            return;
        }

        try {
            await store.saveGearSet(name, this.currentGearSetId);

            // Update tracking state
            this.currentGearSetId = store.state.gearsets.selectedId;
            this.originalName = name;
            this.originalGear = JSON.parse(JSON.stringify(store.state.gearsets.current));

            // Show success toast
            if (this.currentGearSetId) {
                api.showSuccess(`Gear set "${name}" saved`);
            } else {
                api.showSuccess(`Gear set "${name}" created`);
            }

            this.render();
        } catch (error) {
            console.error('Failed to save gear set:', error);
            api.showError('Failed to save gear set');
        }
    }

    /**
     * Load a saved gear set
     * Requirements: 1.9
     * 
     * @param {string} gearSetId - ID of gear set to load
     */
    load(gearSetId) {
        store.loadGearSet(gearSetId);

        // Close dropdown after loading
        this.dropdownOpen = false;
        this.render();
    }

    /**
     * Delete a gear set (with confirmation)
     * Requirements: 1.8, 1.10
     * 
     * @param {string} gearSetId - ID of gear set to delete
     */
    async delete(gearSetId) {
        // First click - show confirmation
        if (this.pendingDelete !== gearSetId) {
            this.pendingDelete = gearSetId;

            // Update just the delete button without re-rendering
            this.updateDeleteButton(gearSetId, true);
            return;
        }

        // Second click - actually delete
        const gearSet = store.state.gearsets.saved[gearSetId];
        const name = gearSet ? gearSet.name : 'gear set';

        try {
            await store.deleteGearSet(gearSetId);

            // Clear pending delete
            this.pendingDelete = null;

            // Show success toast
            api.showSuccess(`Gear set "${name}" deleted`);

            // Keep dropdown open and update content
            // Save scroll position before updating
            const $list = this.$element.find('.gear-set-list');
            const scrollTop = $list.length ? $list.scrollTop() : 0;

            // Update only dropdown content (don't close dropdown)
            const $dropdown = this.$element.find('.gear-set-dropdown');
            $dropdown.html(this.renderDropdownContent());

            // Restore scroll position
            if (scrollTop > 0) {
                const $newList = this.$element.find('.gear-set-list');
                if ($newList.length) {
                    $newList.scrollTop(scrollTop);
                }
            }

            // Re-initialize keyboard navigation
            this.initKeyboardNav();
        } catch (error) {
            console.error('Failed to delete gear set:', error);
            api.showError('Failed to delete gear set');
        }
    }

    /**
     * Update a single delete button without re-rendering entire dropdown
     * @param {string} gearSetId - ID of gear set
     * @param {boolean} showConfirm - Whether to show confirmation state
     */
    updateDeleteButton(gearSetId, showConfirm) {
        const $button = this.$element.find(`.delete-button[data-id="${gearSetId}"], .delete-confirm[data-id="${gearSetId}"]`);

        if ($button.length) {
            if (showConfirm) {
                $button.removeClass('delete-button').addClass('delete-confirm');
                $button.text('Delete?');
            } else {
                $button.removeClass('delete-confirm').addClass('delete-button');
                $button.text('×');
            }
        }
    }

    /**
     * Create a new gear set (clear name, keep gear)
     * Requirements: 1.6
     */
    createNew() {
        store.createNewGearSet();

        // Close dropdown
        this.dropdownOpen = false;

        // Reset tracking state
        this.currentGearSetId = null;
        this.originalName = '';
        this.originalGear = JSON.parse(JSON.stringify(store.state.gearsets.current));

        this.render();
    }

    /**
     * Toggle dropdown open/closed
     */
    toggleDropdown() {
        // Prevent toggling during animation
        const $dropdown = this.$element.find('.gear-set-dropdown');
        if ($dropdown.is(':animated')) {
            console.log('Dropdown is animating, ignoring toggle');
            return;
        }

        console.log('toggleDropdown called, current state:', this.dropdownOpen);
        this.dropdownOpen = !this.dropdownOpen;
        this.searchText = '';  // Reset search when opening
        this.pendingDelete = null;  // Clear any pending deletes
        console.log('New dropdown state:', this.dropdownOpen);

        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');

        if (this.dropdownOpen) {
            // Opening - update content and show with animation
            $dropdown.html(this.renderDropdownContent());
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);

            // Initialize keyboard navigation after dropdown is shown
            setTimeout(() => {
                this.initKeyboardNav();
            }, 250);
        } else {
            // Closing - hide with animation
            if (this.keyboardNav) {
                this.keyboardNav.detach();
                this.keyboardNav = null;
            }

            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
        }
    }

    /**
     * Initialize keyboard navigation
     */
    initKeyboardNav() {
        const $dropdown = this.$element.find('.gear-set-dropdown');

        if (this.keyboardNav) {
            this.keyboardNav.detach();
        }

        this.keyboardNav = new KeyboardNavigator($dropdown, {
            itemSelector: '.gear-set-item',
            onSelect: ($item) => {
                if ($item.hasClass('new-gear-set')) {
                    this.createNew();
                } else {
                    const id = $item.data('id');
                    this.load(id);
                }
            },
            getVisibleItems: () => {
                return this.$element.find('.gear-set-item:visible');
            }
        });

        this.keyboardNav.attach();
    }

    /**
     * Render just the dropdown content (without the wrapper)
     */
    renderDropdownContent() {
        const filteredGearSets = this.getFilteredGearSets();

        // Render gear set list items
        const gearSetItems = filteredGearSets.map(gs => {
            const isPendingDelete = this.pendingDelete === gs.id;
            const deleteButtonClass = isPendingDelete ? 'delete-confirm' : 'delete-button';
            const deleteButtonText = isPendingDelete ? 'Delete?' : '×';

            return `
                <div class="gear-set-item" data-id="${gs.id}">
                    <span class="gear-set-name">${gs.name}</span>
                    <button class="${deleteButtonClass}" data-id="${gs.id}">${deleteButtonText}</button>
                </div>
            `;
        }).join('');

        return `
            <input 
                type="text" 
                class="gear-set-search" 
                placeholder="Search gear sets..."
                value="${this.searchText}"
            />
            <div class="gear-set-list">
                <div class="gear-set-item new-gear-set">
                    <span class="gear-set-name">+ New Gear Set</span>
                </div>
                ${gearSetItems}
            </div>
        `;
    }

    /**
     * Update search text
     * @param {string} text - Search text
     */
    updateSearch(text) {
        this.searchText = text;

        // Only update dropdown content, not the entire component
        if (this.dropdownOpen) {
            // Save focus state
            const $searchInput = this.$element.find('.gear-set-search');
            const hadFocus = $searchInput.is(':focus');
            const cursorPos = hadFocus ? $searchInput[0].selectionStart : 0;

            const $dropdown = this.$element.find('.gear-set-dropdown');
            $dropdown.html(this.renderDropdownContent());

            // Restore focus and cursor position
            if (hadFocus) {
                const $newSearchInput = this.$element.find('.gear-set-search');
                $newSearchInput.focus();
                if ($newSearchInput[0]) {
                    $newSearchInput[0].setSelectionRange(cursorPos, cursorPos);
                }
            }

            // Re-initialize keyboard navigation after content update
            this.initKeyboardNav();
        }
    }

    /**
     * Update gear set name (without re-rendering)
     * @param {string} name - New name
     */
    updateName(name) {
        store.state.gearsets.selectedName = name;
        // Don't notify subscribers to avoid re-render on every keystroke
        // Just update the save button state
        this.updateSaveButtonState();
    }

    /**
     * Update save button enabled/disabled state without full re-render
     */
    updateSaveButtonState() {
        const canSave = this.canSave();
        const $saveButton = this.$element.find('.save-button');

        if (canSave) {
            $saveButton.prop('disabled', false);
        } else {
            $saveButton.prop('disabled', true);
        }
    }

    /**
     * Filter gear sets by search text
     * Requirements: 1.4
     * 
     * @returns {Array} Filtered gear sets
     */
    getFilteredGearSets() {
        const saved = store.state.gearsets.saved || {};
        const gearSets = Object.entries(saved).map(([id, data]) => ({
            id,
            name: data.name
        }));

        if (!this.searchText) {
            return gearSets;
        }

        const searchLower = this.searchText.toLowerCase();
        return gearSets.filter(gs => gs.name.toLowerCase().includes(searchLower));
    }

    /**
     * Render the dropdown content
     * Requirements: 1.3, 1.4, 1.5, 1.7, 1.8
     * 
     * @returns {string} HTML for dropdown
     */
    renderDropdown() {
        console.log('renderDropdown called, dropdownOpen:', this.dropdownOpen);

        // Always render the wrapper so jQuery can manipulate it
        // Start hidden, jQuery will show/hide it
        const content = this.dropdownOpen ? this.renderDropdownContent() : '';

        return `
            <div class="gear-set-dropdown" style="display: none;">
                ${content}
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 1.1, 1.3, 1.13
     */
    render() {
        const selectedName = store.state.gearsets.selectedName || '';
        const canSave = this.canSave();
        const arrowIcon = `<span class="expand-arrow ${this.dropdownOpen ? 'expanded' : ''}">▼</span>`;

        const dropdownHtml = this.renderDropdown();
        console.log('Rendering GearSetManager, dropdownOpen:', this.dropdownOpen, 'dropdown HTML length:', dropdownHtml.length);

        const html = `
            <div class="gear-set-manager">
                <div class="gear-set-header">
                    <button 
                        class="save-button" 
                        ${canSave ? '' : 'disabled'}
                    >
                        Save
                    </button>
                    <div class="gear-set-dropdown-button">
                        <input 
                            type="text" 
                            class="gear-set-name-input" 
                            placeholder="New Gear Set"
                            value="${selectedName}"
                            maxlength="100"
                        />
                        <button class="dropdown-toggle">${arrowIcon}</button>
                    </div>
                </div>
                ${dropdownHtml}
            </div>
        `;

        this.$element.html(html);
        console.log('GearSetManager rendered, dropdown in DOM:', this.$element.find('.gear-set-dropdown').length);
    }

    /**
     * Render while preserving scroll position in dropdown
     */
    renderPreservingScroll() {
        if (!this.dropdownOpen) {
            // If dropdown is closed, just do a normal render
            this.render();
            return;
        }

        // Save current scroll position
        const $list = this.$element.find('.gear-set-list');
        const scrollTop = $list.length ? $list.scrollTop() : 0;

        // Update only dropdown content
        const $dropdown = this.$element.find('.gear-set-dropdown');
        $dropdown.html(this.renderDropdownContent());

        // Restore scroll position
        if (scrollTop > 0) {
            const $newList = this.$element.find('.gear-set-list');
            if ($newList.length) {
                $newList.scrollTop(scrollTop);
            }
        }

        // Re-initialize keyboard navigation
        this.initKeyboardNav();
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Save button click
        this.$element.on('click', '.save-button:not([disabled])', () => {
            this.save();
        });

        // Name input change
        this.$element.on('input', '.gear-set-name-input', (e) => {
            this.updateName($(e.target).val());
        });

        // Dropdown toggle
        this.$element.on('click', '.dropdown-toggle', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Search input
        this.$element.on('input', '.gear-set-search', (e) => {
            this.updateSearch($(e.target).val());
        });

        // New gear set click
        this.$element.on('click', '.new-gear-set', () => {
            this.createNew();
        });

        // Gear set item click (load)
        this.$element.on('click', '.gear-set-item:not(.new-gear-set)', (e) => {
            // Don't trigger if clicking delete button
            if ($(e.target).hasClass('delete-button') || $(e.target).hasClass('delete-confirm')) {
                return;
            }

            // Clear any pending delete
            if (this.pendingDelete) {
                this.updateDeleteButton(this.pendingDelete, false);
                this.pendingDelete = null;
            }

            const id = $(e.currentTarget).data('id');
            this.load(id);
        });

        // Delete button click
        this.$element.on('click', '.delete-button, .delete-confirm', (e) => {
            e.stopPropagation();  // Don't trigger gear set load
            const id = $(e.currentTarget).data('id');

            // If there's a different pending delete, reset it first
            if (this.pendingDelete && this.pendingDelete !== id) {
                this.updateDeleteButton(this.pendingDelete, false);
            }

            this.delete(id);
        });

        // Click outside to close dropdown
        $(document).on('click', (e) => {
            if (this.dropdownOpen && !$(e.target).closest('.gear-set-manager').length) {
                this.dropdownOpen = false;
                this.pendingDelete = null;

                // Close dropdown without re-rendering
                const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
                const $dropdown = this.$element.find('.gear-set-dropdown');
                $arrow.removeClass('expanded');
                $dropdown.slideUp(200);
            }
        });
    }
}

export default GearSetManager;
