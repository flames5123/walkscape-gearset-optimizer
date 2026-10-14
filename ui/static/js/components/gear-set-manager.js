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
import CleanupModal from './cleanup-modal.js';
import { resolveGearsetTarget, targetMatchesSelection, buildMatchSelection } from './gearset-suggest-match.js';

// Build marker so debug logs empirically prove which build the browser loaded.
const GEARSET_SUGGEST_JS_BUILD = 'gs-suggest-2026-08-14g';
console.log('[gs-suggest] module loaded, build=' + GEARSET_SUGGEST_JS_BUILD);

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

        // Suggestion state
        this._suggestTarget = null;
        this._suggestVisible = false;
        this._suggestExpanded = false; // true when dismiss options are showing
        this._suggestEnabled = this._loadSuggestSetting();
        // Cached {activities, recipesBySkill, locations} for name->target resolution.
        // Populated async from the live selector-dropdown caches (preferred) or by
        // fetching the (304-cached) /api endpoints. NOT held on store.state.
        this._suggestData = null;
        this._suggestDataLoading = false;
        // Kick off the data load now so it's ready by the time a set is picked.
        this._ensureSuggestData();

        // "Show matching gear sets first" (opt-in, default OFF). When on, the
        // saved-set dropdown floats sets whose name resolves to the current
        // activity/recipe/travel to the top and highlights them. Reuses the same
        // _suggestData + resolver as the reverse suggestion feature above.
        this._sortMatchingFirst = this._loadSortMatchingFirstSetting();
        // Memoize name->target resolution (resolver scans all activities/recipes/
        // locations per name; a user can have hundreds of saved sets). Cleared
        // whenever _suggestData (re)loads. Keyed by raw gear-set name.
        this._matchTargetCache = new Map();

        // Listen for global setting changes
        window.addEventListener('suggestMatchingActivityChanged', (e) => {
            this._suggestEnabled = e.detail.value;
            if (!this._suggestEnabled) {
                this._hideSuggestion();
            } else {
                this._evaluateSuggestion();
            }
        });

        // Re-render the saved list when the "matching first" setting is toggled
        // or when the current activity/recipe/travel selection changes (so the
        // ordering/highlight tracks the live selection while the dropdown is open).
        window.addEventListener('sortMatchingGearsetsFirstChanged', (e) => {
            this._sortMatchingFirst = !!(e.detail && e.detail.value);
            if (this.dropdownOpen) this.renderPreservingScroll();
        });
        this.subscribe('column3.selectedActivity', () => this._onSelectionContextChange());
        this.subscribe('column3.selectedRecipe', () => this._onSelectionContextChange());
        this.subscribe('column3.travelStart', () => this._onSelectionContextChange());
        this.subscribe('column3.travelEnd', () => this._onSelectionContextChange());

        // Subscribe to gear set state changes
        this.subscribe('gearsets.selectedId', () => this.onSelectionChange());
        this.subscribe('gearsets.selectedName', () => {
            if (this._isSlot2Active()) return; // Ignore GS1 name changes when GS2 is active
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
        this.subscribe('gearsets.gearset2SavedName', () => {
            if (!this._isSlot2Active()) return; // Ignore GS2 name changes when GS1 is active
            if (this.dropdownOpen) {
                const $nameInput = this.$element.find('.gear-set-name-input');
                if ($nameInput.length) {
                    $nameInput.val(store.state.gearsets.gearset2SavedName || '');
                }
                this.updateSaveButtonState();
            } else {
                this.render();
            }
        });
        this.subscribe('gearsets.gearset2SavedId', () => {
            if (this._isSlot2Active()) this.onSelectionChange();
        });
        this.subscribe('gearsets.activeGearsetSlot', () => this.onSelectionChange());
        this.subscribe('gearsets.current', () => this.render());
        this.subscribe('gearsets.gearset2', () => {
            if (this._isSlot2Active()) this.render();
        });
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

        // Create cleanup modal container
        this.$cleanupContainer = $('<div class="cleanup-modal-container"></div>');
        $('body').append(this.$cleanupContainer);
        this.cleanupModal = new CleanupModal(this.$cleanupContainer[0]);
    }

    /**
     * Check if comparison mode slot 2 is active
     */
    _isSlot2Active() {
        return store.state.gearsets.comparisonMode && store.state.gearsets.activeGearsetSlot === 2;
    }

    /**
     * Get the active name for the current slot
     */
    _getActiveName() {
        return this._isSlot2Active()
            ? (store.state.gearsets.gearset2SavedName || '')
            : (store.state.gearsets.selectedName || '');
    }

    /**
     * Get the active ID for the current slot
     */
    _getActiveId() {
        return this._isSlot2Active()
            ? store.state.gearsets.gearset2SavedId
            : store.state.gearsets.selectedId;
    }

    /**
     * Get the active gear object for the current slot
     */
    _getActiveGear() {
        return this._isSlot2Active()
            ? store.state.gearsets.gearset2
            : store.state.gearsets.current;
    }

    /**
     * Handle selection change - update tracking state
     */
    onSelectionChange() {
        const selectedId = this._getActiveId();
        const selectedName = this._getActiveName();

        this.currentGearSetId = selectedId;
        this.originalName = selectedName;

        // Deep copy current gear for comparison
        this.originalGear = JSON.parse(JSON.stringify(this._getActiveGear()));

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

        // Evaluate suggestion after selection changes
        this._evaluateSuggestion();
    }

    /**
     * Check if there are unsaved changes
     * Requirements: 1.13
     * 
     * @returns {boolean} True if name or gear has changed
     */
    hasChanges() {
        const currentName = this._getActiveName();
        const currentGear = this._getActiveGear();

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
        const currentName = this._getActiveName();

        // Must have a name AND have changes
        return currentName.trim().length > 0 && this.hasChanges();
    }

    /**
     * Save current gear set
     * Requirements: 1.9
     */
    async save() {
        const name = this._getActiveName().trim();

        if (!name) {
            api.showError('Please enter a gear set name');
            return;
        }

        try {
            await store.saveGearSet(name, this.currentGearSetId);

            // Update tracking state
            this.currentGearSetId = this._getActiveId();
            this.originalName = name;
            this.originalGear = JSON.parse(JSON.stringify(this._getActiveGear()));

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
        // In comparison mode with slot 2 active, load into gearset 2
        if (store.state.gearsets.comparisonMode && store.state.gearsets.activeGearsetSlot === 2) {
            store.loadGearSetToSlot2(gearSetId);
        } else {
            store.loadGearSet(gearSetId);
        }

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
        if (this._isSlot2Active()) {
            // For slot 2, clear the gearset2 name/id but keep gear
            store.state.gearsets.gearset2SavedId = null;
            store.state.gearsets.gearset2SavedName = '';
            store._notifySubscribers('gearsets.gearset2SavedId');
            store._notifySubscribers('gearsets.gearset2SavedName');
        } else {
            store.createNewGearSet();
        }

        // Close dropdown
        this.dropdownOpen = false;

        // Reset tracking state
        this.currentGearSetId = null;
        this.originalName = '';
        this.originalGear = JSON.parse(JSON.stringify(this._getActiveGear()));

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
            // Page load only fetches the first 50 most-recent gearsets; the
            // rest are pulled lazily here on first dropdown open. Users with
            // <=50 gearsets pay nothing extra. Users with more see the partial
            // list immediately and the rest fade in when the fetch resolves
            // (typically <1s). Idempotent — subsequent opens skip the fetch.
            if (!store.state.gearsets.allLoaded && !this._loadingAllInProgress) {
                this._loadingAllInProgress = true;
                Promise.resolve(store._loadAllGearSets?.()).then(() => {
                    this._loadingAllInProgress = false;
                    if (this.dropdownOpen) {
                        const $dd = this.$element.find('.gear-set-dropdown');
                        $dd.html(this.renderDropdownContent());
                        this.initKeyboardNav();
                    }
                });
            }
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
                } else if ($item.hasClass('gear-set-loading-row')) {
                    // No-op — placeholder while remaining gearsets load.
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

        // Render gear set list items. When "matching first" is active, the list
        // is already sorted matches-first; we tag matching rows for highlight and
        // drop a single divider at the matches -> non-matches boundary.
        const anyMatches = filteredGearSets.some(gs => gs.matches);
        let dividerInserted = false;
        const gearSetItems = filteredGearSets.map((gs, idx) => {
            const isPendingDelete = this.pendingDelete === gs.id;
            const deleteButtonClass = isPendingDelete ? 'delete-confirm' : 'delete-button';
            const deleteButtonText = isPendingDelete ? 'Delete?' : '×';

            // Insert one divider once we cross from the matching group into the
            // rest (only when there is a genuine boundary, i.e. some of each).
            let divider = '';
            if (anyMatches && !gs.matches && !dividerInserted) {
                dividerInserted = true;
                divider = `<div class="gear-set-divider" aria-hidden="true"><span>Other gear sets</span></div>`;
            }

            const matchClass = gs.matches ? ' gear-set-matching' : '';
            const matchBadge = gs.matches
                ? `<span class="gear-set-match-badge" title="Matches your current ${gs.matchType || 'selection'}">★</span>`
                : '';

            return `
                ${divider}
                <div class="gear-set-item${matchClass}" data-id="${gs.id}">
                    ${matchBadge}
                    <span class="gear-set-name">${gs.name}</span>
                    <button class="${deleteButtonClass}" data-id="${gs.id}">${deleteButtonText}</button>
                </div>
            `;
        }).join('');

        // Page load only fetches the first 50 most-recent gearsets to keep
        // gearsets_load fast. The rest are pulled on the first dropdown open
        // (handled in toggleDropdown). While that fetch is in flight we show
        // a small "Loading remaining gearsets…" row so the user understands
        // the list might still grow.
        const allLoaded = !!store.state.gearsets.allLoaded;
        const isLoadingAll = !!this._loadingAllInProgress;
        let pendingRow = '';
        if (!allLoaded && isLoadingAll) {
            pendingRow = `
                <div class="gear-set-item gear-set-loading-row" aria-disabled="true">
                    <span class="gear-set-name">Loading remaining gearsets…</span>
                </div>
            `;
        }

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
                <div class="gear-set-item cleanup-gear-sets">
                    <span class="gear-set-name">Clean Up Duplicates</span>
                </div>
                ${gearSetItems}
                ${pendingRow}
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
        if (this._isSlot2Active()) {
            store.state.gearsets.gearset2SavedName = name;
        } else {
            store.state.gearsets.selectedName = name;
        }
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
        let gearSets = Object.entries(saved).map(([id, data]) => ({
            id,
            name: data.name
        }));

        if (this.searchText) {
            const searchLower = this.searchText.toLowerCase();
            gearSets = gearSets.filter(gs => gs.name.toLowerCase().includes(searchLower));
        }

        // Opt-in: float sets matching the current activity/recipe/travel to the
        // top and tag them for highlighting. Annotates gs.matches in place.
        return this._applyMatchingFirst(gearSets);
    }

    /**
     * When "show matching gear sets first" is enabled AND resolver data is loaded
     * AND there's a current selection, tag each gear set with a `matches` boolean
     * (does its name resolve to the current activity/recipe/travel?) and stable-
     * sort matching sets to the front. Otherwise returns the list unchanged (with
     * matches=false) so rendering is uniform.
     *
     * Stable within each group: preserves the original saved order among matches
     * and among non-matches (Array.prototype.sort is stable in modern engines).
     * @param {Array<{id:string,name:string}>} gearSets
     * @returns {Array<{id:string,name:string,matches:boolean,matchType?:string}>}
     */
    _applyMatchingFirst(gearSets) {
        // Default: nothing matches (uniform, cheap path).
        for (const gs of gearSets) { gs.matches = false; gs.matchType = null; }

        if (!this._sortMatchingFirst || !this._suggestData) {
            // If the feature is on but data isn't ready, trigger a load; the
            // dropdown re-renders when it resolves (_ensureSuggestData).
            if (this._sortMatchingFirst && !this._suggestData) this._ensureSuggestData();
            return gearSets;
        }

        const selection = buildMatchSelection(store.state.column3 || {});
        const hasSelection = !!(selection.selectedActivity || selection.selectedRecipe ||
            (selection.travelStart && selection.travelEnd));
        if (!hasSelection) return gearSets;

        for (const gs of gearSets) {
            const target = this._resolveTargetCached(gs.name);
            if (targetMatchesSelection(target, selection)) {
                gs.matches = true;
                gs.matchType = target.type; // 'activity' | 'recipe' | 'travel'
            }
        }

        // Stable partition: matches first, original relative order preserved.
        return gearSets.sort((a, b) => (a.matches === b.matches ? 0 : (a.matches ? -1 : 1)));
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
        const selectedName = this._getActiveName();
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
                <div class="gearset-suggest-row" style="display:none;"></div>
            </div>
        `;

        this.$element.html(html);
        console.log('GearSetManager rendered, dropdown in DOM:', this.$element.find('.gear-set-dropdown').length);
        // The render above recreates the (empty) .gearset-suggest-row, which would
        // wipe a button shown by an earlier evaluate (e.g. the load()->render race).
        // Re-evaluate against the current selection so the button re-appears if it
        // still applies. _evaluateSuggestion never calls render(), so no recursion.
        if (this._suggestEnabled !== undefined) {
            this._evaluateSuggestion();
        }
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

        // Clean up duplicates click
        this.$element.on('click', '.cleanup-gear-sets', () => {
            this.dropdownOpen = false;
            const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
            const $dropdown = this.$element.find('.gear-set-dropdown');
            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
            this.cleanupModal.open();
        });

        // Gear set item click (load)
        this.$element.on('click', '.gear-set-item:not(.new-gear-set):not(.cleanup-gear-sets):not(.gear-set-loading-row)', (e) => {
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

        // --- Suggestion row event handlers ---
        this.$element.on('click', '.gearset-suggest-apply', () => {
            this._applySuggestion();
        });

        this.$element.on('click', '.gearset-suggest-x', (e) => {
            e.stopPropagation();
            this._toggleDismissOptions();
        });

        this.$element.on('click', '.gearset-suggest-dismiss-set', () => {
            this._dismissForSet();
        });

        this.$element.on('click', '.gearset-suggest-dismiss-global', () => {
            this._dismissGlobal();
        });
    }

    // --- Suggestion helpers ---

    /**
     * Load the activities/recipes/locations needed for name->target matching.
     * Prefers the live selector-dropdown caches (already fetched on page load);
     * falls back to the (server 304-cached) /api endpoints. Re-runs the
     * suggestion evaluation once the data lands.
     */
    async _ensureSuggestData() {
        if (this._suggestData || this._suggestDataLoading) return;
        this._suggestDataLoading = true;
        try {
            let activities = window.activitySelector?.activitiesData?.activities;
            if (!Array.isArray(activities)) {
                const r = await $.get('/api/activities');
                activities = r?.activities || [];
            }
            let recipesBySkill = window.recipeSelector?.recipesData?.by_skill;
            if (!recipesBySkill || typeof recipesBySkill !== 'object') {
                const r = await $.get('/api/recipes');
                recipesBySkill = r?.by_skill || {};
            }
            let locations = [];
            try {
                const rl = await $.get('/api/locations');
                locations = rl?.regions || [];
            } catch (e) {
                locations = [];
            }
            this._suggestData = { activities: activities || [], recipesBySkill: recipesBySkill || {}, locations };
        } catch (e) {
            console.warn('[gearset-suggest] failed to load matching data:', e);
            // Leave _suggestData null; a later evaluation will retry.
        } finally {
            this._suggestDataLoading = false;
        }
        if (this._suggestData) this._evaluateSuggestion();
        // Name->target resolution can only succeed once data is present. Drop any
        // negative cache entries computed before load and refresh the open list
        // so "matching first" ordering/highlight applies as soon as data arrives.
        if (this._suggestData) {
            this._matchTargetCache?.clear();
            if (this.dropdownOpen && this._sortMatchingFirst) this.renderPreservingScroll();
        }
    }

    _loadSuggestSetting() {
        const saved = localStorage.getItem('suggestMatchingActivity');
        return saved === null ? true : saved === 'true';
    }

    /**
     * Load the opt-in "show matching gear sets first" setting. Default OFF.
     */
    _loadSortMatchingFirstSetting() {
        return localStorage.getItem('sortMatchingGearsetsFirst') === 'true';
    }

    /**
     * The current activity/recipe/travel selection changed. If the dropdown is
     * open and "matching first" is on, re-order/re-highlight to track it.
     */
    _onSelectionContextChange() {
        if (this.dropdownOpen && this._sortMatchingFirst) {
            this.renderPreservingScroll();
        }
    }

    /**
     * Resolve a gear-set name to its target (activity/recipe/travel), memoized.
     * Returns null when data isn't loaded yet or the name doesn't resolve to a
     * single unambiguous target. Uses the quiet resolver path to avoid flooding
     * the console when many sets are resolved on each render.
     * @param {string} name
     * @returns {Object|null}
     */
    _resolveTargetCached(name) {
        if (!this._suggestData || !name) return null;
        if (this._matchTargetCache.has(name)) return this._matchTargetCache.get(name);
        const { activities, recipesBySkill, locations } = this._suggestData;
        const target = resolveGearsetTarget(name, { activities, recipesBySkill, locations }, { quiet: true });
        this._matchTargetCache.set(name, target);
        return target;
    }

    _evaluateSuggestion() {
        const _selId = this._getActiveId();
        const _name = _selId ? (store.state.gearsets.saved?.[_selId]?.name) : null;
        console.log('[gs-suggest] evaluate:', {
            enabled: this._suggestEnabled,
            selectedId: _selId,
            name: _name,
            dataReady: !!this._suggestData,
            dismissed: _selId ? !!store.state.gearsets.saved?.[_selId]?.suggestDismissed : null
        });
        if (!this._suggestEnabled) {
            console.log('[gs-suggest] skip: setting disabled');
            this._hideSuggestion();
            return;
        }

        const selectedId = this._getActiveId();
        if (!selectedId) {
            console.log('[gs-suggest] skip: no selected saved set');
            this._hideSuggestion();
            return;
        }

        const savedGearset = store.state.gearsets.saved?.[selectedId];
        if (!savedGearset) {
            console.log('[gs-suggest] skip: selectedId not in saved map');
            this._hideSuggestion();
            return;
        }

        // Check per-set dismissed
        if (savedGearset.suggestDismissed) {
            console.log('[gs-suggest] skip: dismissed for this set');
            this._hideSuggestion();
            return;
        }

        const name = savedGearset.name;
        if (!name) {
            this._hideSuggestion();
            return;
        }

        // Get client-side data (activities/recipes/locations are NOT on store.state;
        // they live on the selector-dropdown instances or the /api endpoints).
        if (!this._suggestData) {
            // Data not ready yet — load it, then this method re-runs on resolve.
            console.log('[gs-suggest] data not ready; loading activities/recipes/locations then re-evaluating');
            this._ensureSuggestData();
            this._hideSuggestion();
            return;
        }
        const { activities, recipesBySkill, locations } = this._suggestData;
        console.log('[gs-suggest] data sizes:', {
            activities: Array.isArray(activities) ? activities.length : 0,
            recipeSkills: recipesBySkill ? Object.keys(recipesBySkill).length : 0,
            regions: Array.isArray(locations) ? locations.length : 0
        });

        const target = resolveGearsetTarget(name, { activities, recipesBySkill, locations });
        console.log('[gs-suggest] resolved target for name "' + name + '":', target);
        if (!target) {
            console.log('[gs-suggest] skip: no single unambiguous target matched the name');
            this._hideSuggestion();
            return;
        }

        // Check if target differs from current selection
        const col3 = store.state.column3 || {};
        let matches = false;
        if (target.type === 'activity' && target.activityId === col3.selectedActivity) {
            matches = true;
        } else if (target.type === 'recipe' && target.recipeId === col3.selectedRecipe) {
            matches = true;
        } else if (target.type === 'travel' &&
                   target.travelStart === col3.travelStart &&
                   target.travelEnd === col3.travelEnd) {
            matches = true;
        }
        console.log('[gs-suggest] match check:', {
            targetType: target.type,
            currentActivity: col3.selectedActivity,
            currentRecipe: col3.selectedRecipe,
            alreadyMatches: matches
        });

        if (matches) {
            console.log('[gs-suggest] skip: target already equals current selection');
            this._hideSuggestion();
            return;
        }

        console.log('[gs-suggest] SHOWING button ->', target.label);
        this._suggestTarget = target;
        this._showSuggestion(target);
    }

    _showSuggestion(target) {
        const $row = this.$element.find('.gearset-suggest-row');
        if (!$row.length) return;

        const typeLabel = target.type === 'travel' ? 'route' : (target.type === 'recipe' ? 'recipe' : 'activity');
        const buttonText = `Change ${typeLabel} to ${target.label}`;

        $row.html(`
            <div class="gearset-suggest-bar">
                <button class="gearset-suggest-apply" title="${buttonText}">${buttonText}</button>
                <div class="gearset-suggest-options" aria-hidden="true">
                    <button class="gearset-suggest-dismiss-set">Dismiss only for this gear set</button>
                    <button class="gearset-suggest-dismiss-global">Never show again</button>
                </div>
                <button class="gearset-suggest-x" title="Dismiss options" aria-label="Dismiss options">×</button>
            </div>
        `);

        this._suggestVisible = true;
        this._suggestExpanded = false;
        $row.slideDown(200);
    }

    _hideSuggestion() {
        this._suggestTarget = null;
        this._suggestVisible = false;
        this._suggestExpanded = false;
        if (this._wrapReadyTimer) {
            clearTimeout(this._wrapReadyTimer);
            this._wrapReadyTimer = null;
        }
        const $row = this.$element.find('.gearset-suggest-row');
        if ($row.length && $row.is(':visible')) {
            $row.slideUp(200);
        }
    }

    _applySuggestion() {
        const target = this._suggestTarget;
        if (!target) { console.log('[gs-suggest] apply: no target'); return; }
        console.log('[gs-suggest] apply:', JSON.stringify(target),
            'hasActivitySel=', !!window.activitySelector, 'hasRecipeSel=', !!window.recipeSelector);

        if (target.type === 'activity') {
            if (window.activitySelector) {
                window.activitySelector.selectActivity(target.activityId);
            } else {
                // Fallback if the selector global isn't available yet.
                store.state.column3.selectedActivity = target.activityId;
                store.state.column3.selectedRecipe = null;
                store._notifySubscribers('column3.selectedActivity');
                store._notifySubscribers('column3.selectedRecipe');
            }
        } else if (target.type === 'recipe') {
            if (window.recipeSelector) {
                window.recipeSelector.selectRecipe(target.recipeId);
            } else {
                store.state.column3.selectedRecipe = target.recipeId;
                store.state.column3.selectedActivity = null;
                store._notifySubscribers('column3.selectedRecipe');
                store._notifySubscribers('column3.selectedActivity');
            }
        } else if (target.type === 'travel') {
            // Travel is the Column-3 "traveling" pseudo-activity: selecting it
            // renders TravelInfoSection (start/end location dropdowns). We set
            // both locations in state, select the pseudo-activity so the section
            // mounts and reads them, then notify so an already-mounted section
            // updates its dropdowns. (Do NOT navigate to the separate travel tab.)
            store.state.column3.travelStart = target.travelStart;
            store.state.column3.travelEnd = target.travelEnd;
            if (window.activitySelector) {
                window.activitySelector.selectActivity('traveling');
            } else {
                store.state.column3.selectedActivity = 'traveling';
                store.state.column3.selectedRecipe = null;
                store._notifySubscribers('column3.selectedActivity');
                store._notifySubscribers('column3.selectedRecipe');
            }
            store._notifySubscribers('column3.travelStart');
            store._notifySubscribers('column3.travelEnd');
        }

        this._hideSuggestion();
    }

    _toggleDismissOptions() {
        this._suggestExpanded = !this._suggestExpanded;
        const $bar = this.$element.find('.gearset-suggest-bar');
        const $opts = this.$element.find('.gearset-suggest-options');
        const $x = this.$element.find('.gearset-suggest-x');
        if (this._wrapReadyTimer) {
            clearTimeout(this._wrapReadyTimer);
            this._wrapReadyTimer = null;
        }
        if (!$opts.length) return;

        if (this._suggestExpanded) {
            $x.text('>').attr({ title: 'Back', 'aria-label': 'Back' });
            // Measure the FINAL height at the expanded (full 50/50) width with ALL
            // transitions off (gs-measuring), so the apply button collapses to 0
            // instantly and the options get their true width — otherwise apply is
            // still mid-width, options wrap huge, and endH comes out too tall
            // (causing an over-expand then pop-down at the end).
            $bar.addClass('gs-measuring expanded');
            $opts.css('height', 'auto');
            void $opts[0].offsetHeight;              // reflow -> final layout
            const endH = $opts.outerHeight();
            // Reset to the collapsed "from" state (still measuring => instant).
            $bar.removeClass('expanded');
            $opts.css('height', '0px');
            void $opts[0].offsetHeight;              // reflow -> collapsed
            // Re-enable transitions, then animate width (flex-grow) + height together.
            $bar.removeClass('gs-measuring');
            $bar.addClass('expanded');
            void $opts[0].offsetHeight;              // commit the 0px start
            $opts.css('height', endH + 'px');
            this._wrapReadyTimer = setTimeout(() => {
                $opts.css('height', '');             // back to CSS height:auto (steady)
                this._wrapReadyTimer = null;
            }, 270);
        } else {
            $x.text('×').attr({ title: 'Dismiss options', 'aria-label': 'Dismiss options' });
            // Collapse: pin current height, then animate width + height to 0.
            const curH = $opts.outerHeight();
            $opts.css({ transition: 'none', height: curH + 'px' });
            void $opts[0].offsetHeight;
            $opts.css('transition', '');
            $bar.removeClass('expanded');
            $opts.css('height', '0px');
            this._wrapReadyTimer = setTimeout(() => {
                $opts.css({ height: '', transition: '' });
                this._wrapReadyTimer = null;
            }, 270);
        }
    }

    _dismissForSet() {
        const selectedId = this._getActiveId();
        if (!selectedId) return;

        // Update local state
        if (store.state.gearsets.saved[selectedId]) {
            store.state.gearsets.saved[selectedId].suggestDismissed = true;
        }

        // Persist to backend
        const uuid = store.state.session?.uuid;
        if (uuid) {
            api.dismissGearSetSuggest(uuid, selectedId);
        }

        this._hideSuggestion();
    }

    _dismissGlobal() {
        // Turn off the global setting
        localStorage.setItem('suggestMatchingActivity', 'false');
        this._suggestEnabled = false;
        window.dispatchEvent(new CustomEvent('suggestMatchingActivityChanged', { detail: { value: false } }));

        // Show toast
        api.showSuccess("You can re-enable this in Settings > UI > Misc UI Settings > 'Suggest matching activity when I pick a saved gear set'");

        this._hideSuggestion();
    }
}

export default GearSetManager;
