/**
 * CustomStatsPopup component
 * 
 * Popup for managing custom stat options.
 * Features:
 * - Checkboxes for all boolean custom stat options
 * - Load options from /api/custom-stats using jQuery AJAX
 * - Save changes to ui_config immediately on toggle
 * - Close button and click-outside-to-close
 * - jQuery fadeIn/fadeOut for smooth transitions
 */

import Component from './base.js';
import api from '../api.js';
import store from '../state.js';

class CustomStatsPopup extends Component {
    /**
     * Create a custom stats popup
     * @param {HTMLElement|string} element - Container element
     */
    constructor(element) {
        super(element);
        this.visible = false;
        this.customStats = [];
        this.isLoading = true;
        this.errorMessage = '';

        // Load custom stats options from API
        this.loadCustomStats();
    }

    /**
     * Load custom stats options from API
     */
    loadCustomStats() {
        this.isLoading = true;
        this.render();
        this.attachEvents();

        api.getCustomStats()
            .done((data) => {
                this.customStats = data.custom_stats || [];
                this.isLoading = false;
                this.render();
                this.attachEvents();
            })
            .fail(() => {
                this.errorMessage = 'Failed to load custom stats options.';
                this.isLoading = false;
                this.render();
                this.attachEvents();
            });
    }

    /**
     * Render the custom stats popup HTML
     * @returns {string} HTML string
     */
    render() {
        const html = `
            <div class="modal-overlay" style="display: none;">
                <div class="modal custom-stats-popup">
                    <div class="modal-header">
                        <h2>Custom Stats (TODO still lacking)</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-content">
                        ${this.isLoading ? `
                            <div style="
                                text-align: center;
                                padding: var(--spacing-xl);
                                color: var(--text-secondary);
                            ">
                                Loading custom stats options...
                            </div>
                        ` : this.errorMessage ? `
                            <div class="custom-stats-error" style="
                                padding: var(--spacing-md);
                                background-color: var(--rarity-ethereal);
                                border: 1px solid #8c2a2a;
                                border-radius: 4px;
                                color: var(--text-primary);
                            ">
                                <strong>Error:</strong> ${this.errorMessage}
                            </div>
                        ` : `
                            <p style="
                                margin-bottom: var(--spacing-lg);
                                color: var(--text-secondary);
                            ">
                                Toggle custom stat options that apply to your character. 
                                These settings persist across character imports.
                            </p>
                            <div class="custom-stats-list">
                                ${this.renderCustomStatsList()}
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);
        return html;
    }

    /**
     * Render the list of custom stats checkboxes
     * @returns {string} HTML string
     */
    renderCustomStatsList() {
        if (!this.customStats || this.customStats.length === 0) {
            return `
                <div style="
                    text-align: center;
                    padding: var(--spacing-xl);
                    color: var(--text-secondary);
                ">
                    No custom stats available.
                </div>
            `;
        }

        return this.customStats.map(stat => {
            // Get current value from store
            const currentValue = store.state.ui.custom_stats?.[stat.id] || stat.default || false;

            console.log(`Rendering ${stat.id}: currentValue=${currentValue}, store.state.ui.custom_stats=`, store.state.ui.custom_stats);

            return `
                <div class="custom-stat-item" style="
                    padding: var(--spacing-md);
                    margin-bottom: var(--spacing-sm);
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                ">
                    <label style="
                        display: flex;
                        align-items: flex-start;
                        cursor: pointer;
                        user-select: none;
                    ">
                        <input 
                            type="checkbox" 
                            class="custom-stat-checkbox" 
                            data-stat-id="${stat.id}"
                            ${currentValue ? 'checked' : ''}
                            style="
                                margin-right: var(--spacing-md);
                                margin-top: 2px;
                                cursor: pointer;
                            "
                        >
                        <div style="flex: 1;">
                            <div style="
                                font-weight: 500;
                                color: var(--text-primary);
                                margin-bottom: var(--spacing-xs);
                            ">
                                ${stat.name}
                            </div>
                            <div style="
                                font-size: 0.9em;
                                color: var(--text-secondary);
                            ">
                                ${stat.description}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        }).join('');
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Remove old handlers to prevent duplicates
        this.$element.off('click', '.close-btn');
        this.$element.off('click', '.modal-overlay');
        this.$element.off('change', '.custom-stat-checkbox');

        // Close button
        this.$element.on('click', '.close-btn', () => {
            this.hide();
        });

        // Click outside modal to close
        this.$element.on('click', '.modal-overlay', (e) => {
            if ($(e.target).hasClass('modal-overlay')) {
                this.hide();
            }
        });

        // Checkbox toggle
        this.$element.on('change', '.custom-stat-checkbox', (e) => {
            const $checkbox = $(e.target);
            const statId = $checkbox.data('stat-id');
            const isChecked = $checkbox.prop('checked');

            this.handleToggle(statId, isChecked);
        });

        // Escape key to close
        $(document).on('keydown.custom-stats-popup', (e) => {
            if (e.key === 'Escape' && this.visible) {
                this.hide();
            }
        });
    }

    /**
     * Handle checkbox toggle
     * @param {string} statId - Custom stat ID
     * @param {boolean} isChecked - New checked state
     */
    handleToggle(statId, isChecked) {
        console.log('Custom stat toggled:', statId, isChecked);

        // Initialize nested structure if it doesn't exist
        if (!store.state.ui.custom_stats) {
            store.state.ui.custom_stats = {};
        }

        // Update local state immediately
        store.state.ui.custom_stats[statId] = isChecked;

        // Sync to backend with the correct path
        const path = `ui.custom_stats.${statId}`;
        console.log('Syncing path:', path, 'to value:', isChecked);
        store.update(path, isChecked);

        // Show feedback
        const statName = this.customStats.find(s => s.id === statId)?.name || statId;
        const message = isChecked
            ? `Enabled: ${statName}`
            : `Disabled: ${statName}`;

        api.showInfo(message);
    }

    /**
     * Show the popup
     */
    show() {
        this.visible = true;
        this.errorMessage = '';

        // Render immediately to show loading state
        this.render();
        this.attachEvents();

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.css('display', 'flex');
        // Small delay to ensure display change is processed
        setTimeout(() => {
            $overlay.addClass('show');
        }, 10);

        // Load custom stats in background
        if (this.customStats.length === 0) {
            this.loadCustomStats();
        }
    }

    /**
     * Hide the popup
     */
    hide() {
        this.visible = false;

        // Remove escape key handler
        $(document).off('keydown.custom-stats-popup');

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.removeClass('show');

        // Wait for animation to complete, then hide
        setTimeout(() => {
            $overlay.css('display', 'none');
        }, 200);
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        // Remove escape key handler
        $(document).off('keydown.custom-stats-popup');
        super.destroy();
    }
}

export default CustomStatsPopup;
