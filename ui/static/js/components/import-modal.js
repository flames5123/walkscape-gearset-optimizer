/**
 * ImportModal component
 * 
 * Modal for importing character data from game export JSON.
 * Features:
 * - First-visit detection (shows automatically if no character_config)
 * - Returning user support (can be dismissed with Cancel)
 * - JSON validation with error display
 * - jQuery AJAX for import submission
 * - Success/error toast notifications
 */

import Component from './base.js';
import api from '../api.js';
import store from '../state.js';

class ImportModal extends Component {
    /**
     * Create an import modal
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {boolean} props.isFirstVisit - Whether this is first visit (no character_config)
     * @param {Function} props.onImportSuccess - Callback when import succeeds
     * @param {Function} props.onCancel - Callback when user cancels
     */
    constructor(element, { isFirstVisit = false, onImportSuccess = null, onCancel = null } = {}) {
        super(element, { isFirstVisit, onImportSuccess, onCancel });
        this.errorMessage = '';
        this.isSubmitting = false;
        this.render();
        this.attachEvents();
    }

    /**
     * Render the import modal HTML
     * @returns {string} HTML string
     */
    render() {
        const title = this.props.isFirstVisit
            ? 'Welcome! Import Your Character'
            : 'Import Character Data';

        const description = this.props.isFirstVisit
            ? 'To get started, paste your character export JSON below, or click Cancel to explore with empty data.'
            : 'Paste your character export JSON to update your data. This will replace your current character configuration.';

        const html = `
            <div class="modal-overlay" style="display: none;">
                <div class="modal import-modal">
                    <div class="modal-header">
                        <h2>${title}</h2>
                    </div>
                    <div class="modal-content">
                        <p style="margin-bottom: var(--spacing-md); color: var(--text-secondary);">
                            ${description}
                        </p>
                        <textarea 
                            class="import-textarea" 
                            placeholder="Paste your character export JSON here..."
                            rows="10"
                            ${this.isSubmitting ? 'disabled' : ''}
                        ></textarea>
                        ${this.errorMessage ? `
                            <div class="import-error" style="
                                margin-top: var(--spacing-md);
                                padding: var(--spacing-md);
                                background-color: var(--rarity-ethereal);
                                border: 1px solid #8c2a2a;
                                border-radius: 4px;
                                color: var(--text-primary);
                            ">
                                <strong>Error:</strong> ${this.errorMessage}
                            </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button 
                            class="button cancel-btn" 
                            ${this.isSubmitting ? 'disabled' : ''}
                        >
                            Cancel
                        </button>
                        <button 
                            class="button button-primary import-btn" 
                            ${this.isSubmitting ? 'disabled' : ''}
                        >
                            ${this.isSubmitting ? 'Importing...' : 'Import'}
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);
        return html;
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Cancel button
        this.$element.on('click', '.cancel-btn', () => {
            this.handleCancel();
        });

        // Import button
        this.$element.on('click', '.import-btn', () => {
            this.handleImport();
        });

        // Close on overlay click (but not modal content)
        this.$element.on('click', '.modal-overlay', (e) => {
            if ($(e.target).hasClass('modal-overlay')) {
                this.handleCancel();
            }
        });

        // Clear error when user starts typing
        this.$element.on('input', '.import-textarea', () => {
            if (this.errorMessage) {
                this.errorMessage = '';
                this.render();
                this.attachEvents();
            }
        });

        // Allow Ctrl+Enter to submit
        this.$element.on('keydown', '.import-textarea', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                this.handleImport();
            }
        });
    }

    /**
     * Handle cancel button click
     */
    handleCancel() {
        if (this.isSubmitting) {
            return;
        }

        // If first visit, set skipped_import flag
        if (this.props.isFirstVisit) {
            store.update('ui.skipped_import', true);
        }

        // Call onCancel callback if provided
        if (this.props.onCancel) {
            this.props.onCancel();
        }

        // Close modal
        this.close();
    }

    /**
     * Handle import button click
     */
    handleImport() {
        if (this.isSubmitting) {
            return;
        }

        // Get JSON from textarea
        const jsonText = this.$element.find('.import-textarea').val().trim();

        // Validate not empty
        if (!jsonText) {
            this.showError('Please paste your character export JSON.');
            return;
        }

        // Validate JSON format
        let parsedJson;
        try {
            parsedJson = JSON.parse(jsonText);
        } catch (e) {
            this.showError('Invalid JSON format. Please check your export and try again.');
            return;
        }

        // Basic validation - check for expected fields
        if (!parsedJson || typeof parsedJson !== 'object') {
            this.showError('Invalid character export format.');
            return;
        }

        // Submit to backend
        this.submitImport(jsonText);
    }

    /**
     * Submit import to backend
     * @param {string} jsonText - Character export JSON string
     */
    submitImport(jsonText) {
        // Set submitting state
        this.isSubmitting = true;
        this.errorMessage = '';
        this.render();
        this.attachEvents();

        // Get session UUID
        const uuid = store.state.session.uuid;

        // Call API
        api.importCharacter(uuid, jsonText)
            .done((response) => {
                // Success!
                api.showSuccess('Character data imported successfully!');

                // Invalidate catalog cache since character data changed
                api.invalidateCatalog();

                // Update state with new character data
                // Response structure: { success, message, session: { character_config, ui_config, ... } }
                if (response.session && response.session.character_config) {
                    store.state.character = response.session.character_config;
                    store._notifySubscribers('character');
                }

                // Clear user overrides on import (fresh character data)
                // Use direct API call to ensure it's saved before reload
                const clearOverrides = {
                    skills: {},
                    skills_xp: {},
                    reputation: {},
                    achievement_points: undefined,
                    coins: undefined,
                    items: {}  // Clear item overrides too
                };

                // Update local state immediately
                store.state.ui.user_overrides = clearOverrides;

                // Save to backend synchronously
                $.ajax({
                    url: `/api/session/${uuid}/config`,
                    method: 'PATCH',
                    contentType: 'application/json',
                    data: JSON.stringify({
                        path: 'ui.user_overrides',
                        value: clearOverrides
                    }),
                    async: false  // Make synchronous to ensure it completes before reload
                });

                // Set skipped_import flag after successful import
                // This prevents the modal from showing again even if character data is cleared
                store.update('ui.skipped_import', true);

                // Check if user has seen custom stats popup
                const hasSeenCustomStats = store.state.ui && store.state.ui.has_seen_custom_stats;

                // Close modal
                this.close();

                // Call onImportSuccess callback if provided
                if (this.props.onImportSuccess) {
                    this.props.onImportSuccess(response, hasSeenCustomStats);
                }
            })
            .fail((xhr, status, error) => {
                // Error - extract message
                let errorMsg = 'Failed to import character data.';

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
     * Close the modal
     */
    close() {
        const $overlay = this.$element.find('.modal-overlay');

        // Remove show class to trigger fade-out animation
        $overlay.removeClass('show');

        // Wait for animation to complete, then hide and clear
        setTimeout(() => {
            $overlay.css('display', 'none');
            this.$element.empty();
        }, 200);
    }

    /**
     * Show the modal (if it was hidden)
     */
    show() {
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
}

export default ImportModal;
