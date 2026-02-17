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

        // Load optimization settings (async, will re-render when loaded)
        this.loadOptimizationSettings();

        this.render();
        this.attachEvents();
    }

    /**
     * Load optimization settings from API
     */
    async loadOptimizationSettings() {
        try {
            const response = await $.get('/api/optimization-settings');
            console.log('Loaded optimization settings:', response);

            this.sortingOptions = {
                activity: response.activity.options,
                recipe: response.recipe.options
            };
            this.activitySorting = response.activity.current_order;
            this.recipeSorting = response.recipe.current_order;

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
        // Render activity sorting list
        const activityItems = this.activitySorting.map((key, index) => {
            const option = this.sortingOptions.activity.find(opt => opt.key === key);
            if (!option) return '';

            return `
                <div class="sort-item" data-key="${key}" data-index="${index}">
                    <span class="drag-handle">☰</span>
                    <span class="sort-name">${option.display_name}</span>
                </div>
            `;
        }).join('');

        // Render recipe sorting list
        const recipeItems = this.recipeSorting.map((key, index) => {
            const option = this.sortingOptions.recipe.find(opt => opt.key === key);
            if (!option) return '';

            return `
                <div class="sort-item" data-key="${key}" data-index="${index}">
                    <span class="drag-handle">☰</span>
                    <span class="sort-name">${option.display_name}</span>
                </div>
            `;
        }).join('');

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
                    ">Activity Gearset Optimization</h3>
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
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Note: Consumable optimization for activities is not yet implemented.</p>
                    </div>
                    
                    <div class="sort-list activity-sort-list">
                        ${activityItems}
                    </div>
                </div>
                
                <div class="setting-section" style="margin-top: var(--spacing-xl);">
                    <h3 style="
                        color: var(--text-primary);
                        font-size: 1.1em;
                        margin-bottom: var(--spacing-md);
                        font-weight: 600;
                    ">Recipe Gearset Optimization</h3>
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
                    
                    <div class="sort-list recipe-sort-list">
                        ${recipeItems}
                    </div>
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

        // ===== DESKTOP DRAG AND DROP =====

        // Drag start
        $list.on('dragstart', '.sort-item', (e) => {
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

            // Update the order in our data
            const isActivity = $list.hasClass('activity-sort-list');
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                $(this).data('index', index);
                newOrder.push(key);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
            this.saveOptimizationSettings();
        });

        // ===== MOBILE TOUCH EVENTS =====

        // Touch start
        $list.on('touchstart', '.sort-item', (e) => {
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

            // Update the order in our data
            const isActivity = $list.hasClass('activity-sort-list');
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                $(this).data('index', index);
                newOrder.push(key);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
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
