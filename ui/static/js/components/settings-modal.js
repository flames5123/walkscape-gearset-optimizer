/**
 * SettingsModal component
 * 
 * Modal for managing session settings.
 * Features:
 * - Display current session UUID
 * - Input field to switch to different session
 * - Close button and click-outside-to-close
 * - jQuery fadeIn/fadeOut for smooth transitions
 * - Session switching with validation
 */

import Component from './base.js';
import api from '../api.js';
import store from '../state.js';

class SettingsModal extends Component {
    /**
     * Create a settings modal
     * @param {HTMLElement|string} element - Container element
     */
    constructor(element) {
        super(element);
        this.visible = false;
        this.errorMessage = '';
        this.isSubmitting = false;
        this.activeTab = 'user'; // 'user', 'optimization', or 'personalization'
        this.customColorTertiary = this.loadCustomColor('customBgTertiary', '#2e2e2e');
        this.customColorHover = this.loadCustomColor('customBgHover', '#333333');

        // Optimization settings
        this.activitySorting = [];
        this.recipeSorting = [];
        this.sortingOptions = { activity: [], recipe: [] };
        this.includeConsumablesActivity = false;
        this.includeConsumablesRecipe = false;
        this.showItemFindingDrops = this.loadShowItemFindingDrops();

        // Optimization presets
        this.activityPresets = [];
        this.recipePresets = [];
        this.selectedActivityPresetId = null;
        this.selectedRecipePresetId = null;

        // Load optimization settings (async, will re-render when loaded)
        this.loadOptimizationSettings();
        this.loadOptimizationPresets();

        this.render();
        this.attachEvents();
    }

    /**
     * Load optimization settings from API
     * Data model: activitySorting and recipeSorting are arrays of [metric_key, weight] tuples
     * where weight is an integer 0-100.
     */
    async loadOptimizationSettings() {
        try {
            const response = await $.get('/api/optimization-settings');
            console.log('Loaded optimization settings:', response);

            this.sortingOptions = {
                activity: response.activity.options,
                recipe: response.recipe.options
            };

            // current_order is already [key, weight] tuples from API
            // Normalize in case of old format (plain strings)
            this.activitySorting = this._normalizeSortingTuples(response.activity.current_order);
            this.recipeSorting = this._normalizeSortingTuples(response.recipe.current_order);

            // Load consumables flags from response or default to false
            this.includeConsumablesActivity = response.activity.include_consumables || false;
            this.includeConsumablesRecipe = response.recipe.include_consumables || false;

            console.log('Activity sorting loaded:', this.activitySorting);
            console.log('Recipe sorting loaded:', this.recipeSorting);
            console.log('Include consumables (activity):', this.includeConsumablesActivity);
            console.log('Include consumables (recipe):', this.includeConsumablesRecipe);

            // Re-render if we're on the optimization tab
            if (this.activeTab === 'optimization' && this.visible) {
                this.render();
                this.attachEvents();
            }
        } catch (error) {
            console.error('Failed to load optimization settings:', error);
        }
    }

    /**
     * Normalize sorting data to [key, weight] tuple format.
     * Handles both old format (plain string arrays) and new format ([key, weight] tuples).
     * @param {Array} sortingList - Array of strings or [key, weight] tuples
     * @returns {Array} Array of [key, weight] tuples
     */
    _normalizeSortingTuples(sortingList) {
        if (!sortingList || !sortingList.length) return [];
        return sortingList.map(entry => {
            if (typeof entry === 'string') {
                return [entry, 100];
            }
            if (Array.isArray(entry) && entry.length === 2) {
                return [entry[0], Math.max(0, Math.min(100, Math.floor(Number(entry[1]) || 100)))];
            }
            return [String(entry), 100];
        });
    }

    /**
     * Update the weight in the internal data model from a sort-item DOM element.
     * @param {jQuery} $item - The .sort-item element
     */
    _updateWeightFromDOM($item) {
        const key = $item.data('key');
        const weight = parseInt($item.find('.weight-slider').val(), 10);
        const isActivity = $item.closest('.sort-list').hasClass('activity-sort-list');

        const sorting = isActivity ? this.activitySorting : this.recipeSorting;
        const entry = sorting.find(e => e[0] === key);
        if (entry) {
            entry[1] = weight;
        }
        // Clear preset selection since user manually changed settings
        this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
        // Debounce save — clear previous timer and set new one
        clearTimeout(this._weightSaveTimer);
        this._weightSaveTimer = setTimeout(() => this.saveOptimizationSettings(), 300);
    }

    /**
     * Clear the preset selection for a type (user manually changed settings).
     * @param {string} presetType - 'activity' or 'recipe'
     */
    _clearPresetSelection(presetType) {
        if (presetType === 'activity') {
            this.selectedActivityPresetId = null;
        } else {
            this.selectedRecipePresetId = null;
        }
    }

    /**
     * Update the slider track background to show a filled blue bar from 0 to current value.
     * @param {HTMLInputElement} slider - The range input element
     */
    _updateSliderTrack(slider) {
        const val = slider.value;
        const pct = ((val - slider.min) / (slider.max - slider.min)) * 100;
        slider.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
    }

    /**
     * Re-render the optimization tab while preserving scroll position.
     * Used by remove, add, and reset handlers.
     */
    _rerenderOptimizationTab() {
        // Save scroll position before re-render
        const $modal = this.$element.find('.settings-modal');
        const scrollTop = $modal.scrollTop();

        this.render();
        this.attachEvents();
        this.$element.find('.modal-overlay').css('display', 'flex').addClass('show');
        this.activeTab = 'optimization';
        this.$element.find('.tab-content').hide();
        this.$element.find('.optimization-tab').show();
        this.$element.find('.settings-tab').removeClass('active');
        this.$element.find('.settings-tab[data-tab="optimization"]').addClass('active');

        // Restore scroll position after re-render
        this.$element.find('.settings-modal').scrollTop(scrollTop);
    }

    /**
     * Load custom color from localStorage
     * @param {string} key - localStorage key
     * @param {string} defaultValue - Default color value
     * @returns {string} Hex color code
     */
    loadCustomColor(key, defaultValue) {
        return localStorage.getItem(key) || defaultValue;
    }

    /**
     * Load show item finding drops setting from localStorage
     * @returns {boolean} Whether to show item finding drops
     */
    loadShowItemFindingDrops() {
        const saved = localStorage.getItem('showItemFindingDrops');
        return saved === null ? false : saved === 'true';  // Default to false
    }

    /**
     * Save show item finding drops setting to localStorage
     * @param {boolean} value - Whether to show item finding drops
     */
    saveShowItemFindingDrops(value) {
        this.showItemFindingDrops = value;
        localStorage.setItem('showItemFindingDrops', value.toString());
        console.log('saveShowItemFindingDrops:', value);

        // Dispatch a custom event so other components can react
        window.dispatchEvent(new CustomEvent('showItemFindingDropsChanged', { detail: { value } }));
    }

    /**
     * Save custom color to localStorage and apply it
     * @param {string} key - localStorage key
     * @param {string} cssVar - CSS variable name
     * @param {string} color - Hex color code
     */
    saveCustomColor(key, cssVar, color) {
        if (key === 'customBgTertiary') {
            this.customColorTertiary = color;
        } else if (key === 'customBgHover') {
            this.customColorHover = color;
        }
        localStorage.setItem(key, color);
        document.documentElement.style.setProperty(cssVar, color);
    }

    /**
     * Render the settings modal HTML
     * @returns {string} HTML string
     */
    render() {
        const currentUuid = store.state.session.uuid || 'No session loaded';

        const html = `
            <div class="modal-overlay" style="display: none;">
                <div class="modal settings-modal">
                    <div class="modal-header">
                        <h2>Settings</h2>
                        <button class="close-btn" ${this.isSubmitting ? 'disabled' : ''}>&times;</button>
                    </div>
                    <div class="settings-tabs">
                        <button type="button" class="settings-tab ${this.activeTab === 'user' ? 'active' : ''}" data-tab="user">User</button>
                        <button type="button" class="settings-tab ${this.activeTab === 'optimization' ? 'active' : ''}" data-tab="optimization">Optimization</button>
                        <button type="button" class="settings-tab ${this.activeTab === 'personalization' ? 'active' : ''}" data-tab="personalization">
                            Personalization
                            <span style="
                                display: inline-block;
                                margin-left: var(--spacing-xs);
                                padding: 2px 6px;
                                background-color: var(--rarity-rare);
                                border-radius: 3px;
                                font-size: 0.7em;
                                font-weight: 600;
                                color: var(--text-primary);
                                vertical-align: middle;
                            ">IN PROGRESS</span>
                        </button>
                    </div>
                    <div class="modal-content">
                        <div class="tab-content user-tab" style="display: ${this.activeTab === 'user' ? 'block' : 'none'};">
                            ${this.renderUserTab(currentUuid)}
                        </div>
                        <div class="tab-content optimization-tab" style="display: ${this.activeTab === 'optimization' ? 'block' : 'none'};">
                            ${this.renderOptimizationTab()}
                        </div>
                        <div class="tab-content personalization-tab" style="display: ${this.activeTab === 'personalization' ? 'block' : 'none'};">
                            ${this.renderPersonalizationTab()}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);
        return html;
    }

    /**
     * Render the User tab content
     * @param {string} currentUuid - Current session UUID
     * @returns {string} HTML string
     */
    renderUserTab(currentUuid) {
        return `
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Current Session UUID:</label>
                <input 
                    type="text" 
                    class="uuid-display" 
                    value="${currentUuid}" 
                    readonly
                    style="
                        width: 100%;
                        padding: var(--spacing-sm);
                        background-color: var(--bg-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        color: var(--text-secondary);
                        font-family: monospace;
                        font-size: 0.9em;
                    "
                >
            </div>
            <div class="setting-row">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Switch to Session:</label>
                <input 
                    type="text" 
                    class="uuid-input" 
                    placeholder="Enter UUID to switch sessions"
                    ${this.isSubmitting ? 'disabled' : ''}
                    style="
                        width: 100%;
                        padding: var(--spacing-sm);
                        background-color: var(--bg-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        color: var(--text-primary);
                        font-family: monospace;
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    "
                >
                ${this.errorMessage ? `
                    <div class="settings-error" style="
                        margin-top: var(--spacing-sm);
                        padding: var(--spacing-sm);
                        background-color: var(--rarity-ethereal);
                        border: 1px solid #8c2a2a;
                        border-radius: 4px;
                        color: var(--text-primary);
                        font-size: 0.9em;
                    ">
                        <strong>Error:</strong> ${this.errorMessage}
                    </div>
                ` : ''}
                <button 
                    class="button button-primary switch-session-btn" 
                    ${this.isSubmitting ? 'disabled' : ''}
                    style="width: 100%;"
                >
                    ${this.isSubmitting ? 'Switching...' : 'Switch Session'}
                </button>
            </div>
        `;
    }

    /**
     * Render the Optimization tab content
     * @returns {string} HTML string
     */
    renderOptimizationTab() {
        const renderSortList = (sorting, options, listClass) => {
            const isSingle = sorting.length <= 1;
            const usedKeys = new Set(sorting.map(entry => entry[0]));
            const availableOptions = options.filter(opt => !usedKeys.has(opt.key));

            const items = sorting.map((entry, index) => {
                const [key, weight] = entry;
                const option = options.find(opt => opt.key === key);
                if (!option) return '';

                return `
                    <div class="sort-item" data-key="${key}" data-index="${index}" data-weight="${weight}">
                        <span class="drag-handle">☰</span>
                        <div class="sort-item-content">
                            <span class="sort-name">${option.display_name}</span>
                            <div class="sort-weight-row">
                                <input type="range" class="weight-slider" min="0" max="100" value="${weight}" />
                                <input type="number" class="weight-input" min="0" max="100" value="${weight}" />
                                <span class="weight-pct">%</span>
                            </div>
                        </div>
                        <button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority">✕</button>
                    </div>
                `;
            }).join('');

            // Add button with dropdown
            const addDropdownOptions = availableOptions.map(opt =>
                `<option value="${opt.key}">${opt.display_name}</option>`
            ).join('');

            const addButton = availableOptions.length > 0 ? `
                <div class="sort-add-wrapper">
                    <button class="sort-add-btn" title="Add optimization priority">+ Add Optimization Priority</button>
                    <select class="sort-add-dropdown" style="display:none;">
                        <option value="">Select a metric...</option>
                        ${addDropdownOptions}
                    </select>
                </div>
            ` : '';

            return `
                ${addButton}
                <div class="sort-list ${listClass}">
                    ${items}
                </div>
                <button class="sort-reset-btn" data-list="${listClass}">↺ Reset to Default</button>
            `;
        };

        return `
            <div class="optimization-settings">
                <div style="
                    background-color: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    padding: var(--spacing-md);
                    margin-bottom: var(--spacing-lg);
                ">
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin: 0;
                    ">💡 <strong>Tip:</strong> To exclude specific items or consumables from optimization, go to the <strong>Owned Items</strong> section in Column 1 and check the "Hide" checkbox. This works for both normal and fine consumables.</p>
                </div>
                
                <div class="weight-explanation">
                    <span class="weight-explanation-icon">ℹ️</span>
                    <div>
                        <p>The weight slider sets a <strong>minimum threshold</strong>: the optimizer won't let a goal drop below this % of its best achievable value.</p>
                        <p>At <strong>100%</strong>, the next priority is used as a tiebreaker (current behavior). Lower values give the optimizer more flexibility to improve lower-priority goals.</p>
                    </div>
                </div>
                
                <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                    <h3 style="
                        color: var(--text-primary);
                        font-size: 1.1em;
                        margin-bottom: var(--spacing-md);
                        font-weight: 600;
                    ">Global Optimization Settings</h3>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="show-item-finding-drops-checkbox" ${this.showItemFindingDrops ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Show item finding drops in Target Drop</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Include drops from item finding stats (e.g., Chance to find fishing bait) in the "Target Drop for Steps/Reward Roll" drop down.</p>
                    </div>
                </div>
                
                <div class="setting-section">
                    <h3 style="
                        color: var(--text-primary);
                        font-size: 1.1em;
                        margin-bottom: var(--spacing-md);
                        font-weight: 600;
                    ">Activity Gear Set Optimization</h3>
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    ">Drag to reorder sorting priorities (top = highest priority). Changes save automatically.</p>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="include-consumables-activity-checkbox" ${this.includeConsumablesActivity ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Include consumables in optimization</span>
                        </label>
                    </div>
                    
                    ${this.renderPresetBar('activity')}
                    ${renderSortList(this.activitySorting, this.sortingOptions.activity, 'activity-sort-list')}
                </div>
                
                <div class="setting-section" style="margin-top: var(--spacing-xl);">
                    <h3 style="
                        color: var(--text-primary);
                        font-size: 1.1em;
                        margin-bottom: var(--spacing-md);
                        font-weight: 600;
                    ">Recipe Gear Set Optimization</h3>
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    ">Drag to reorder sorting priorities (top = highest priority). Changes save automatically.</p>
                    <p style="
                        color: var(--text-muted);
                        font-size: 0.85em;
                        margin-bottom: var(--spacing-sm);
                        font-style: italic;
                    ">Note: Quality-specific options (Materials/Steps for X Quality) only apply to recipes that produce quality items.</p>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="include-consumables-recipe-checkbox" ${this.includeConsumablesRecipe ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Include consumables in optimization</span>
                        </label>
                    </div>
                    
                    ${this.renderPresetBar('recipe')}
                    ${renderSortList(this.recipeSorting, this.sortingOptions.recipe, 'recipe-sort-list')}
                </div>
            </div>
        `;
    }

    /**
     * Render the Personalization tab content
     * @returns {string} HTML string
     */
    renderPersonalizationTab() {
        return `
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Background Tertiary Color: (weird locations for now)</label>
                <div style="display: flex; gap: var(--spacing-sm); align-items: center;">
                    <input 
                        type="color" 
                        class="color-picker-tertiary" 
                        value="${this.customColorTertiary}"
                        style="
                            width: 60px;
                            height: 40px;
                            padding: 2px;
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            cursor: pointer;
                        "
                    >
                    <input 
                        type="text" 
                        class="color-text-input-tertiary" 
                        value="${this.customColorTertiary}"
                        placeholder="#0f0f14"
                        maxlength="7"
                        style="
                            flex: 1;
                            padding: var(--spacing-sm);
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            color: var(--text-primary);
                            font-family: monospace;
                            font-size: 0.9em;
                        "
                    >
                </div>
                <div style="
                    margin-top: var(--spacing-sm);
                    padding: var(--spacing-sm);
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-secondary);
                    font-size: 0.85em;
                ">
                    Used for column headers, buttons, and other tertiary background elements.
                </div>
            </div>
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Background Hover Color:</label>
                <div style="display: flex; gap: var(--spacing-sm); align-items: center;">
                    <input 
                        type="color" 
                        class="color-picker-hover" 
                        value="${this.customColorHover}"
                        style="
                            width: 60px;
                            height: 40px;
                            padding: 2px;
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            cursor: pointer;
                        "
                    >
                    <input 
                        type="text" 
                        class="color-text-input-hover" 
                        value="${this.customColorHover}"
                        placeholder="#333333"
                        maxlength="7"
                        style="
                            flex: 1;
                            padding: var(--spacing-sm);
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            color: var(--text-primary);
                            font-family: monospace;
                            font-size: 0.9em;
                        "
                    >
                </div>
                <div style="
                    margin-top: var(--spacing-sm);
                    padding: var(--spacing-sm);
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-secondary);
                    font-size: 0.85em;
                ">
                    Used for hover states on buttons, items, and interactive elements.
                </div>
            </div>
            <div class="setting-row">
                <button 
                    class="button button-primary reset-color-btn" 
                    style="width: 100%;"
                >
                    Reset All to Default
                </button>
            </div>
        `;
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Remove any existing handlers first
        this.$element.off();
        $(document).off('keydown.settings-modal');

        // Tab switching - just toggle visibility, don't re-render
        this.$element.on('click', '.settings-tab', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const tab = $(e.currentTarget).data('tab');
            if (tab !== this.activeTab) {
                this.activeTab = tab;

                // Update active class on tabs
                this.$element.find('.settings-tab').removeClass('active');
                $(e.currentTarget).addClass('active');

                // Show/hide tab content
                this.$element.find('.tab-content').hide();
                this.$element.find(`.${tab}-tab`).show();
            }
            return false;
        });

        // Close button
        this.$element.on('click', '.close-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            return false;
        });

        // Click outside modal to close - be more specific
        this.$element.on('click', '.modal-overlay', (e) => {
            // Only close if clicking directly on the overlay, not on any child elements
            if (e.target === e.currentTarget) {
                this.hide();
            }
        });

        // Switch session button
        this.$element.on('click', '.switch-session-btn', () => {
            this.handleSwitchSession();
        });

        // Enter key in input
        this.$element.on('keypress', '.uuid-input', (e) => {
            if (e.which === 13) { // Enter key
                this.handleSwitchSession();
            }
        });

        // Clear error when user starts typing
        this.$element.on('input', '.uuid-input', () => {
            if (this.errorMessage) {
                this.errorMessage = '';
                this.render();
                this.attachEvents();
            }
        });

        // Color picker change - tertiary
        this.$element.on('input', '.color-picker-tertiary', (e) => {
            const color = $(e.target).val();
            this.$element.find('.color-text-input-tertiary').val(color);
            this.saveCustomColor('customBgTertiary', '--bg-tertiary', color);
        });

        // Color text input change - tertiary
        this.$element.on('input', '.color-text-input-tertiary', (e) => {
            const color = $(e.target).val();
            // Validate hex color format
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                this.$element.find('.color-picker-tertiary').val(color);
                this.saveCustomColor('customBgTertiary', '--bg-tertiary', color);
            }
        });

        // Color picker change - hover
        this.$element.on('input', '.color-picker-hover', (e) => {
            const color = $(e.target).val();
            this.$element.find('.color-text-input-hover').val(color);
            this.saveCustomColor('customBgHover', '--bg-hover', color);
        });

        // Color text input change - hover
        this.$element.on('input', '.color-text-input-hover', (e) => {
            const color = $(e.target).val();
            // Validate hex color format
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                this.$element.find('.color-picker-hover').val(color);
                this.saveCustomColor('customBgHover', '--bg-hover', color);
            }
        });

        // Reset color button
        this.$element.on('click', '.reset-color-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const defaultTertiary = '#0f0f14';
            const defaultHover = '#333333';

            this.saveCustomColor('customBgTertiary', '--bg-tertiary', defaultTertiary);
            this.saveCustomColor('customBgHover', '--bg-hover', defaultHover);

            // Update the inputs
            this.$element.find('.color-picker-tertiary').val(defaultTertiary);
            this.$element.find('.color-text-input-tertiary').val(defaultTertiary);
            this.$element.find('.color-picker-hover').val(defaultHover);
            this.$element.find('.color-text-input-hover').val(defaultHover);

            return false;
        });

        // Drag and drop for sorting lists
        this.attachDragAndDrop('.activity-sort-list');
        this.attachDragAndDrop('.recipe-sort-list');

        // Preset dropdown toggle
        this.$element.on('click', '.preset-dropdown-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            if (presetType === 'activity') {
                this._activityPresetDropdownOpen = !this._activityPresetDropdownOpen;
            } else {
                this._recipePresetDropdownOpen = !this._recipePresetDropdownOpen;
            }
            this._rerenderOptimizationTab();
            this.attachEvents();
        });

        // Preset name input
        this.$element.on('input', '.preset-name-input', (e) => {
            const presetType = $(e.target).data('preset-type');
            const name = $(e.target).val();
            if (presetType === 'activity') {
                this._activityPresetName = name;
            } else {
                this._recipePresetName = name;
            }
            // Update save button state without full re-render
            const $saveBtn = $(e.target).closest('.preset-bar').find('.preset-save-btn');
            const hasName = name.trim().length > 0;
            $saveBtn.prop('disabled', !hasName);
            $saveBtn.css({
                'background': hasName ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                'color': hasName ? 'white' : 'var(--text-muted)',
                'border-color': hasName ? 'var(--accent-color)' : 'var(--border-color)',
                'cursor': hasName ? 'pointer' : 'default'
            });
        });

        // Preset save button
        this.$element.on('click', '.preset-save-btn', (e) => {
            e.preventDefault();
            const presetType = $(e.currentTarget).data('preset-type');
            this.savePreset(presetType);
        });

        // Preset item click (load)
        this.$element.on('click', '.preset-item:not(.new-preset)', (e) => {
            if ($(e.target).hasClass('preset-item-delete')) return;
            const presetType = $(e.currentTarget).data('preset-type');
            const presetId = $(e.currentTarget).data('id');
            // Close dropdown
            if (presetType === 'activity') {
                this._activityPresetDropdownOpen = false;
            } else {
                this._recipePresetDropdownOpen = false;
            }
            this.loadPreset(presetType, presetId);
        });

        // New preset click
        this.$element.on('click', '.preset-item.new-preset', (e) => {
            const presetType = $(e.currentTarget).data('preset-type');
            if (presetType === 'activity') {
                this.selectedActivityPresetId = null;
                this._activityPresetName = '';
                this._activityPresetDropdownOpen = false;
            } else {
                this.selectedRecipePresetId = null;
                this._recipePresetName = '';
                this._recipePresetDropdownOpen = false;
            }
            this._rerenderOptimizationTab();
            this.attachEvents();
            // Focus the name input
            this.$element.find(`.preset-name-input[data-preset-type="${presetType}"]`).focus();
        });

        // Preset item delete
        this.$element.on('click', '.preset-item-delete', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const presetId = $(e.currentTarget).data('id');
            const pendingKey = presetType === 'activity' ? '_activityPendingDelete' : '_recipePendingDelete';

            if (this[pendingKey] === presetId) {
                // Second click — confirm delete
                this[pendingKey] = null;
                this.deletePreset(presetType, presetId);
            } else {
                // First click — show confirm
                this[pendingKey] = presetId;
                this._rerenderOptimizationTab();
                this.attachEvents();
                // Auto-clear after 3 seconds
                setTimeout(() => {
                    if (this[pendingKey] === presetId) {
                        this[pendingKey] = null;
                        this._rerenderOptimizationTab();
                        this.attachEvents();
                    }
                }, 3000);
            }
        });

        // Preset export button
        this.$element.on('click', '.preset-export-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const encoded = this.encodePreset(presetType);

            // Show the import input field with the encoded string for easy copying
            const $input = this.$element.find(`.preset-import-input[data-preset-type="${presetType}"]`);
            $input.show().val(encoded).select();

            // Try to copy to clipboard
            try {
                document.execCommand('copy');
                const $btn = $(e.currentTarget);
                const original = $btn.text();
                $btn.text('Copied!');
                setTimeout(() => $btn.text(original), 1500);
            } catch (err) {
                // Input is shown and selected, user can copy manually
            }
        });

        // Preset import button — toggle input visibility
        this.$element.on('click', '.preset-import-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const $input = this.$element.find(`.preset-import-input[data-preset-type="${presetType}"]`);
            $input.toggle().val('').focus();
        });

        // Preset import input — apply on Enter
        this.$element.on('keydown', '.preset-import-input', (e) => {
            if (e.key === 'Enter') {
                const presetType = $(e.target).data('preset-type');
                const encoded = $(e.target).val();
                if (encoded.trim()) {
                    this.decodeAndApplyPreset(presetType, encoded);
                }
            } else if (e.key === 'Escape') {
                $(e.target).hide().val('');
            }
        });

        // Weight slider ↔ numeric input bidirectional sync
        this.$element.on('input', '.weight-slider', (e) => {
            const $slider = $(e.target);
            const val = parseInt($slider.val(), 10);
            $slider.closest('.sort-item').find('.weight-input').val(val);
            this._updateSliderTrack($slider[0]);
            this._updateWeightFromDOM($slider.closest('.sort-item'));
        });

        this.$element.on('change', '.weight-input', (e) => {
            const $input = $(e.target);
            let val = parseInt($input.val(), 10);
            if (isNaN(val)) val = 100;
            val = Math.max(0, Math.min(100, val));
            $input.val(val);
            const $slider = $input.closest('.sort-item').find('.weight-slider');
            $slider.val(val);
            this._updateSliderTrack($slider[0]);
            this._updateWeightFromDOM($input.closest('.sort-item'));
        });

        // Initialize slider track fills on render
        this.$element.find('.weight-slider').each((_, el) => {
            this._updateSliderTrack(el);
        });

        // Remove button
        this.$element.on('click', '.sort-remove-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            if ($btn.prop('disabled')) return;

            const $item = $btn.closest('.sort-item');
            const key = $item.data('key');
            const isActivity = $item.closest('.sort-list').hasClass('activity-sort-list');

            if (isActivity) {
                this.activitySorting = this.activitySorting.filter(entry => entry[0] !== key);
            } else {
                this.recipeSorting = this.recipeSorting.filter(entry => entry[0] !== key);
            }

            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();
            this._rerenderOptimizationTab();
            return false;
        });

        // Add button → show dropdown
        this.$element.on('click', '.sort-add-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $wrapper = $(e.currentTarget).closest('.sort-add-wrapper');
            const $dropdown = $wrapper.find('.sort-add-dropdown');
            $dropdown.val('');
            $dropdown.toggle();
            return false;
        });

        // Add dropdown selection
        this.$element.on('change', '.sort-add-dropdown', (e) => {
            const $dropdown = $(e.target);
            const key = $dropdown.val();
            if (!key) return;

            const $wrapper = $dropdown.closest('.sort-add-wrapper');
            const $list = $wrapper.next('.sort-list');
            const isActivity = $list.hasClass('activity-sort-list');

            if (isActivity) {
                this.activitySorting.push([key, 100]);
            } else {
                this.recipeSorting.push([key, 100]);
            }

            $dropdown.hide();
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();
            this._rerenderOptimizationTab();
        });

        // Reset to default button
        this.$element.on('click', '.sort-reset-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const listClass = $(e.currentTarget).data('list');
            const isActivity = listClass === 'activity-sort-list';
            const options = isActivity ? this.sortingOptions.activity : this.sortingOptions.recipe;

            // Reset to all options in default order with weight 100
            const defaultSorting = options.map(opt => [opt.key, 100]);
            if (isActivity) {
                this.activitySorting = defaultSorting;
            } else {
                this.recipeSorting = defaultSorting;
            }

            this.saveOptimizationSettings();
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this._rerenderOptimizationTab();
        });

        // Include consumables checkboxes
        this.$element.on('change', '.include-consumables-activity-checkbox', (e) => {
            this.includeConsumablesActivity = e.target.checked;
            this.saveConsumablesSettings();
        });

        this.$element.on('change', '.include-consumables-recipe-checkbox', (e) => {
            this.includeConsumablesRecipe = e.target.checked;
            this.saveConsumablesSettings();
        });

        // Show item finding drops checkbox
        this.$element.on('change', '.show-item-finding-drops-checkbox', (e) => {
            this.saveShowItemFindingDrops(e.target.checked);
        });

        // Escape key to close
        $(document).on('keydown.settings-modal', (e) => {
            if (e.key === 'Escape' && this.visible) {
                this.hide();
            }
        });
    }

    /**
     * Handle switch session button click
     */
    handleSwitchSession() {
        if (this.isSubmitting) {
            return;
        }

        // Get UUID from input
        const newUuid = this.$element.find('.uuid-input').val().trim();

        // Validate not empty
        if (!newUuid) {
            this.showError('Please enter a session UUID.');
            return;
        }

        // Validate UUID format (basic check)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(newUuid)) {
            this.showError('Invalid UUID format. Please enter a valid UUID.');
            return;
        }

        // Check if it's the same as current
        if (newUuid === store.state.session.uuid) {
            this.showError('This is already your current session.');
            return;
        }

        // Submit switch request
        this.switchSession(newUuid);
    }

    /**
     * Switch to a different session
     * @param {string} newUuid - UUID of session to switch to
     */
    switchSession(newUuid) {
        // Set submitting state
        this.isSubmitting = true;
        this.errorMessage = '';
        this.render();
        this.attachEvents();

        // Load new session
        api.getSession(newUuid)
            .done((data) => {
                // Update store with new session
                store.state.session.uuid = newUuid;
                store.state.character = data.character_config || {};
                store.state.ui = data.ui_config || {};

                // Update cookie
                document.cookie = `session_uuid=${newUuid}; path=/; max-age=31536000`;

                // Show success message
                api.showSuccess('Session switched successfully!');

                // Notify all subscribers
                store._notifySubscribers('session');

                // Close modal and reload page
                this.hide();

                // Reload page after a short delay to show success message
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            })
            .fail((xhr, status, error) => {
                // Error - extract message
                let errorMsg = 'Failed to switch session.';

                if (xhr.responseJSON) {
                    if (xhr.responseJSON.message) {
                        errorMsg = xhr.responseJSON.message;
                    } else if (xhr.responseJSON.detail) {
                        errorMsg = xhr.responseJSON.detail;
                    } else if (xhr.responseJSON.error) {
                        errorMsg = xhr.responseJSON.error;
                    }
                }

                // Show error in modal
                this.showError(errorMsg);
            })
            .always(() => {
                // Reset submitting state
                this.isSubmitting = false;
                this.render();
                this.attachEvents();
            });
    }

    /**
     * Show error message in modal
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.errorMessage = message;
        this.render();
        this.attachEvents();
    }

    /**
     * Show the modal
     */
    async show() {
        this.visible = true;
        this.errorMessage = '';

        // Reload optimization settings when opening modal
        await this.loadOptimizationSettings();

        this.render();
        this.attachEvents();

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.css('display', 'flex');
        // Small delay to ensure display change is processed
        setTimeout(() => {
            $overlay.addClass('show');
        }, 10);
    }

    /**
     * Hide the modal
     */
    hide() {
        if (this.isSubmitting) {
            return;
        }

        this.visible = false;

        // Remove escape key handler
        $(document).off('keydown.settings-modal');

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.removeClass('show');

        // Wait for animation to complete, then hide
        setTimeout(() => {
            $overlay.css('display', 'none');
            // Clear input after hiding
            this.$element.find('.uuid-input').val('');
            this.errorMessage = '';
        }, 200);
    }

    /**
     * Attach drag and drop handlers to a sorting list
     * @param {string} selector - CSS selector for the list
     */
    attachDragAndDrop(selector) {
        const $list = this.$element.find(selector);
        let draggedElement = null;
        let draggedIndex = null;
        let touchStartY = 0;
        let touchCurrentY = 0;
        let placeholder = null;

        // Make items draggable (for desktop)
        $list.find('.sort-item').each(function () {
            $(this).attr('draggable', 'true');
        });

        // Prevent drag when interacting with slider, input, or remove button
        $list.on('mousedown', '.weight-slider, .weight-input, .sort-remove-btn', (e) => {
            // Temporarily disable draggable on the parent sort-item
            const $item = $(e.target).closest('.sort-item');
            $item.attr('draggable', 'false');
            $(document).one('mouseup', () => {
                $item.attr('draggable', 'true');
            });
        });

        // ===== DESKTOP DRAG AND DROP =====

        // Drag start
        $list.on('dragstart', '.sort-item', (e) => {
            // Don't start drag if it originated from slider/input/button
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'button') {
                e.preventDefault();
                return;
            }
            draggedElement = e.currentTarget;
            draggedIndex = parseInt($(draggedElement).data('index'));
            $(draggedElement).addClass('dragging');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
        });

        // Drag end
        $list.on('dragend', '.sort-item', (e) => {
            $(draggedElement).removeClass('dragging');
            draggedElement = null;
            draggedIndex = null;
        });

        // Drag over
        $list.on('dragover', '.sort-item', (e) => {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'move';

            const $target = $(e.currentTarget);
            if ($target[0] === draggedElement) return;

            // Get bounding rect
            const rect = $target[0].getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            // Determine if we should insert before or after
            if (e.originalEvent.clientY < midpoint) {
                $target.before($(draggedElement));
            } else {
                $target.after($(draggedElement));
            }
        });

        // Drop
        $list.on('drop', '.sort-item', (e) => {
            e.preventDefault();

            // Update the order in our data, preserving weights
            const isActivity = $list.hasClass('activity-sort-list');
            const sorting = isActivity ? this.activitySorting : this.recipeSorting;
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                const weight = parseInt($(this).data('weight'), 10) || 100;
                $(this).data('index', index);
                newOrder.push([key, weight]);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();
        });

        // ===== MOBILE TOUCH EVENTS =====

        // Touch start
        $list.on('touchstart', '.sort-item', (e) => {
            // Don't start drag if touching slider, input, or remove button
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'button') {
                return;
            }
            draggedElement = e.currentTarget;
            draggedIndex = parseInt($(draggedElement).data('index'));
            touchStartY = e.originalEvent.touches[0].clientY;
            touchCurrentY = touchStartY;

            // Add dragging class after a short delay to distinguish from scrolling
            setTimeout(() => {
                if (draggedElement) {
                    $(draggedElement).addClass('dragging');
                }
            }, 100);
        });

        // Touch move
        $list.on('touchmove', '.sort-item', (e) => {
            if (!draggedElement) return;

            e.preventDefault(); // Prevent scrolling while dragging
            touchCurrentY = e.originalEvent.touches[0].clientY;

            // Find which element we're over
            const elements = $list.find('.sort-item').not('.dragging');
            let targetElement = null;

            elements.each(function () {
                const rect = this.getBoundingClientRect();
                if (touchCurrentY >= rect.top && touchCurrentY <= rect.bottom) {
                    targetElement = this;
                    return false; // Break loop
                }
            });

            if (targetElement && targetElement !== draggedElement) {
                const rect = targetElement.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                // Determine if we should insert before or after
                if (touchCurrentY < midpoint) {
                    $(targetElement).before($(draggedElement));
                } else {
                    $(targetElement).after($(draggedElement));
                }
            }
        });

        // Touch end
        $list.on('touchend touchcancel', '.sort-item', (e) => {
            if (!draggedElement) return;

            $(draggedElement).removeClass('dragging');

            // Update the order in our data, preserving weights
            const isActivity = $list.hasClass('activity-sort-list');
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                const weight = parseInt($(this).data('weight'), 10) || 100;
                $(this).data('index', index);
                newOrder.push([key, weight]);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();

            // Reset state
            draggedElement = null;
            draggedIndex = null;
            touchStartY = 0;
            touchCurrentY = 0;
        });
    }

    /**
     * Save consumables settings to backend
     */
    async saveConsumablesSettings() {
        try {
            console.log('Saving consumables settings:', {
                activity_include_consumables: this.includeConsumablesActivity,
                recipe_include_consumables: this.includeConsumablesRecipe
            });

            const response = await $.ajax({
                url: '/api/optimization-settings',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    activity_sorting: this.activitySorting,
                    recipe_sorting: this.recipeSorting,
                    activity_include_consumables: this.includeConsumablesActivity,
                    recipe_include_consumables: this.includeConsumablesRecipe
                })
            });

            console.log('Save response:', response);
            console.log('✓ Consumables settings saved');

            // Update store state so optimize button can read it
            if (!store.state.column3) {
                store.state.column3 = {};
            }
            store.state.column3.includeConsumables = this.includeConsumablesActivity || this.includeConsumablesRecipe;

        } catch (error) {
            console.error('Failed to save consumables settings:', error);
            api.showError('Failed to save consumables settings');
        }
    }

    /**
     * Save optimization settings to backend
     */
    async saveOptimizationSettings() {
        try {
            console.log('Saving optimization settings:', {
                activity_sorting: this.activitySorting,
                recipe_sorting: this.recipeSorting
            });

            const response = await $.ajax({
                url: '/api/optimization-settings',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    activity_sorting: this.activitySorting,
                    recipe_sorting: this.recipeSorting,
                    activity_include_consumables: this.includeConsumablesActivity,
                    recipe_include_consumables: this.includeConsumablesRecipe
                })
            });

            console.log('Save response:', response);

            // Don't show success toast on every drag - it's annoying
            // Just log success
            console.log('✓ Optimization settings saved');
        } catch (error) {
            console.error('Failed to save optimization settings:', error);
            api.showError('Failed to save optimization settings');
        }
    }

    // ========================================================================
    // OPTIMIZATION PRESETS
    // ========================================================================

    async loadOptimizationPresets() {
        try {
            const [activityPresets, recipePresets] = await Promise.all([
                $.get('/api/optimization-presets/activity'),
                $.get('/api/optimization-presets/recipe')
            ]);
            this.activityPresets = activityPresets || [];
            this.recipePresets = recipePresets || [];
            console.log('Loaded presets:', { activity: this.activityPresets.length, recipe: this.recipePresets.length });
            if (this.activeTab === 'optimization' && this.visible) {
                this._rerenderOptimizationTab();
            }
        } catch (error) {
            console.error('Failed to load optimization presets:', error);
        }
    }

    async savePreset(presetType) {
        const name = (presetType === 'activity' ? this._activityPresetName : this._recipePresetName) || '';
        if (!name.trim()) {
            api.showError('Enter a preset name first');
            return;
        }

        const sorting = presetType === 'activity' ? this.activitySorting : this.recipeSorting;
        const includeConsumables = presetType === 'activity' ? this.includeConsumablesActivity : this.includeConsumablesRecipe;
        const selectedId = presetType === 'activity' ? this.selectedActivityPresetId : this.selectedRecipePresetId;

        try {
            const preset = await $.ajax({
                url: `/api/optimization-presets/${presetType}`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    name: name.trim(),
                    sorting: sorting,
                    include_consumables: includeConsumables,
                    id: selectedId  // Update existing if selected
                })
            });
            console.log('Preset saved:', preset);
            await this.loadOptimizationPresets();
            if (presetType === 'activity') {
                this.selectedActivityPresetId = preset.id;
                this._activityPresetName = preset.name;
            } else {
                this.selectedRecipePresetId = preset.id;
                this._recipePresetName = preset.name;
            }
            this._rerenderOptimizationTab();
            this.attachEvents();
        } catch (error) {
            const msg = error.responseJSON?.detail || 'Failed to save preset';
            api.showError(msg);
        }
    }

    async loadPreset(presetType, presetId) {
        const presets = presetType === 'activity' ? this.activityPresets : this.recipePresets;
        const preset = presets.find(p => p.id === presetId);
        if (!preset) return;

        if (presetType === 'activity') {
            this.activitySorting = this._normalizeSortingTuples(preset.sorting);
            this.includeConsumablesActivity = preset.include_consumables;
            this.selectedActivityPresetId = presetId;
            this._activityPresetName = preset.name;
        } else {
            this.recipeSorting = this._normalizeSortingTuples(preset.sorting);
            this.includeConsumablesRecipe = preset.include_consumables;
            this.selectedRecipePresetId = presetId;
            this._recipePresetName = preset.name;
        }

        // Save to current settings too
        await this.saveOptimizationSettings();
        this._rerenderOptimizationTab();
        this.attachEvents();
    }

    async deletePreset(presetType, presetId) {
        try {
            await $.ajax({
                url: `/api/optimization-presets/${presetType}/${presetId}`,
                method: 'DELETE'
            });
            // Clear selection if deleted preset was selected
            if (presetType === 'activity' && this.selectedActivityPresetId === presetId) {
                this.selectedActivityPresetId = null;
                this._activityPresetName = '';
            } else if (presetType === 'recipe' && this.selectedRecipePresetId === presetId) {
                this.selectedRecipePresetId = null;
                this._recipePresetName = '';
            }
            await this.loadOptimizationPresets();
            this._rerenderOptimizationTab();
            this.attachEvents();
        } catch (error) {
            api.showError('Failed to delete preset');
        }
    }


    renderPresetBar(presetType) {
        const presets = presetType === 'activity' ? this.activityPresets : this.recipePresets;
        const selectedId = presetType === 'activity' ? this.selectedActivityPresetId : this.selectedRecipePresetId;
        const selectedPreset = presets.find(p => p.id === selectedId);
        const currentName = presetType === 'activity'
            ? (this._activityPresetName ?? (selectedPreset ? selectedPreset.name : ''))
            : (this._recipePresetName ?? (selectedPreset ? selectedPreset.name : ''));
        const dropdownOpen = presetType === 'activity' ? this._activityPresetDropdownOpen : this._recipePresetDropdownOpen;

        const hasName = currentName.trim().length > 0;
        const hasChanges = hasName; // Can save if there's a name

        const presetItems = presets.map(p => {
            const isSelected = p.id === selectedId;
            const pendingDelete = (presetType === 'activity' ? this._activityPendingDelete : this._recipePendingDelete) === p.id;
            return `
                <div class="preset-item ${isSelected ? 'selected' : ''}" data-id="${p.id}" data-preset-type="${presetType}">
                    <span class="preset-item-name">${p.name}</span>
                    <button class="preset-item-delete ${pendingDelete ? 'confirm' : ''}" data-id="${p.id}" data-preset-type="${presetType}">${pendingDelete ? 'Delete?' : '×'}</button>
                </div>
            `;
        }).join('');

        const dropdownContent = dropdownOpen ? `
            <div class="preset-dropdown" data-preset-type="${presetType}">
                <div class="preset-list">
                    <div class="preset-item new-preset" data-preset-type="${presetType}">
                        <span class="preset-item-name">+ New Preset</span>
                    </div>
                    ${presetItems}
                </div>
            </div>
        ` : '<div class="preset-dropdown" style="display:none;"></div>';

        return `
            <div class="preset-bar" data-preset-type="${presetType}" style="
                margin-bottom: var(--spacing-md);
            ">
                <div style="
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-xs);
                ">
                    <button class="preset-save-btn" data-preset-type="${presetType}" ${hasChanges ? '' : 'disabled'} style="
                        padding: 5px 12px;
                        font-size: 0.85em;
                        background: ${hasChanges ? 'var(--accent-color)' : 'var(--bg-tertiary)'};
                        color: ${hasChanges ? 'white' : 'var(--text-muted)'};
                        border: 1px solid ${hasChanges ? 'var(--accent-color)' : 'var(--border-color)'};
                        border-radius: 3px 0 0 3px;
                        cursor: ${hasChanges ? 'pointer' : 'default'};
                        white-space: nowrap;
                    ">Save</button>
                    <div style="
                        display: flex;
                        flex: 1;
                        position: relative;
                    ">
                        <input type="text"
                            class="preset-name-input"
                            data-preset-type="${presetType}"
                            placeholder="Preset Name"
                            value="${currentName}"
                            maxlength="100"
                            style="
                                flex: 1;
                                padding: 5px 8px;
                                background: var(--bg-primary);
                                color: var(--text-primary);
                                border: 1px solid var(--border-color);
                                border-right: none;
                                border-radius: 0;
                                font-size: 0.9em;
                                outline: none;
                            "
                        />
                        <button class="preset-dropdown-toggle" data-preset-type="${presetType}" style="
                            padding: 5px 8px;
                            background: var(--bg-secondary);
                            color: var(--text-secondary);
                            border: 1px solid var(--border-color);
                            border-radius: 0 3px 3px 0;
                            cursor: pointer;
                            font-size: 0.75em;
                        "><span class="expand-arrow ${dropdownOpen ? 'expanded' : ''}">▼</span></button>
                    </div>
                </div>
                ${dropdownContent}
                <div class="preset-import-export" style="
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-xs);
                    margin-top: var(--spacing-xs);
                ">
                    <button class="preset-export-btn" data-preset-type="${presetType}" style="
                        padding: 3px 10px;
                        font-size: 0.8em;
                        background: var(--bg-secondary);
                        color: var(--text-secondary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        cursor: pointer;
                    ">Export</button>
                    <button class="preset-import-btn" data-preset-type="${presetType}" style="
                        padding: 3px 10px;
                        font-size: 0.8em;
                        background: var(--bg-secondary);
                        color: var(--text-secondary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        cursor: pointer;
                    ">Import</button>
                    <input type="text" class="preset-import-input" data-preset-type="${presetType}" placeholder="Paste preset string..." style="
                        display: none;
                        flex: 1;
                        padding: 3px 8px;
                        font-size: 0.8em;
                        background: var(--bg-primary);
                        color: var(--text-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        font-family: monospace;
                    " />
                </div>
            </div>
        `;
    }

    /**
     * Encode current sorting settings to a shareable string (gzip + base64).
     */
    encodePreset(presetType) {
        const sorting = presetType === 'activity' ? this.activitySorting : this.recipeSorting;
        const includeConsumables = presetType === 'activity' ? this.includeConsumablesActivity : this.includeConsumablesRecipe;
        const data = { sorting, include_consumables: includeConsumables };
        const jsonStr = JSON.stringify(data);
        const compressed = window.pako.gzip(jsonStr);
        let binary = '';
        const bytes = new Uint8Array(compressed);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Decode a preset string and apply it.
     */
    decodeAndApplyPreset(presetType, encoded) {
        try {
            const binaryString = atob(encoded.trim());
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const decompressed = window.pako.ungzip(bytes, { to: 'string' });
            const data = JSON.parse(decompressed);

            if (!data.sorting || !Array.isArray(data.sorting)) {
                throw new Error('Invalid preset format');
            }

            const sorting = this._normalizeSortingTuples(data.sorting);
            const includeConsumables = data.include_consumables || false;

            if (presetType === 'activity') {
                this.activitySorting = sorting;
                this.includeConsumablesActivity = includeConsumables;
                this.selectedActivityPresetId = null;
                this._activityPresetName = '';
            } else {
                this.recipeSorting = sorting;
                this.includeConsumablesRecipe = includeConsumables;
                this.selectedRecipePresetId = null;
                this._recipePresetName = '';
            }

            this.saveOptimizationSettings();
            this._rerenderOptimizationTab();
            this.attachEvents();
            return true;
        } catch (e) {
            console.error('Failed to decode preset:', e);
            api.showError('Invalid preset string');
            return false;
        }
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        // Remove escape key handler
        $(document).off('keydown.settings-modal');
        super.destroy();
    }
}

export default SettingsModal;
