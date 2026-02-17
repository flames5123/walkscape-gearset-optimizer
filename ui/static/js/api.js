/**
 * API Client - Backend Communication with jQuery AJAX
 * 
 * Wraps all backend API calls with consistent error handling
 * and toast notifications.
 */

class ApiClient {
    constructor() {
        this.baseUrl = '/api';
        this._catalogCache = null;
        this._catalogPromise = null;
    }

    /**
     * GET session data
     * @param {string} uuid - Session UUID
     * @returns {Promise} jQuery promise with session data
     */
    getSession(uuid) {
        return $.get(`${this.baseUrl}/session/${uuid}`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load session');
            });
    }

    /**
     * POST import character data
     * @param {string} uuid - Session UUID
     * @param {string} exportJson - Character export JSON string
     * @returns {Promise} jQuery promise
     */
    importCharacter(uuid, exportJson) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/import`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ export_json: exportJson })
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to import character data');
        });
    }

    /**
     * PATCH update config
     * @param {string} uuid - Session UUID
     * @param {string} path - Config path (e.g., "skills.mining")
     * @param {*} value - New value
     * @returns {Promise} jQuery promise
     */
    updateConfig(uuid, path, value) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/config`,
            method: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ path, value })
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to update configuration');
        });
    }

    /**
     * POST trigger recalculations
     * @param {string} uuid - Session UUID
     * @returns {Promise} jQuery promise
     */
    calculate(uuid) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/calculate`,
            method: 'POST',
            contentType: 'application/json'
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to run calculations');
        });
    }

    /**
     * GET items catalog
     * @returns {Promise} jQuery promise with items data
     */
    getItems() {
        return $.get(`${this.baseUrl}/items`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load items catalog');
            });
    }

    /**
     * GET skills definitions
     * @returns {Promise} jQuery promise with skills data
     */
    getSkills() {
        return $.get(`${this.baseUrl}/skills`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load skills');
            });
    }

    /**
     * GET custom stats options
     * @returns {Promise} jQuery promise with custom stats options
     */
    getCustomStats() {
        return $.get(`${this.baseUrl}/custom-stats`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load custom stats options');
            });
    }

    /**
     * GET catalog (items with full details)
     * Cached — catalog data doesn't change during a session.
     * Call invalidateCatalog() after character import to refresh.
     * @returns {Promise} jQuery promise with catalog data
     */
    getCatalog() {
        // Return cached data if available
        if (this._catalogCache) {
            return $.Deferred().resolve(this._catalogCache).promise();
        }

        // If a request is already in flight, return that promise
        if (this._catalogPromise) {
            return this._catalogPromise;
        }

        // Make the request and cache the result
        this._catalogPromise = $.get(`${this.baseUrl}/catalog`)
            .done((data) => {
                this._catalogCache = data;
                this._catalogPromise = null;
            })
            .fail((xhr, status, error) => {
                this._catalogPromise = null;
                this.handleError(xhr, 'Failed to load catalog');
            });

        return this._catalogPromise;
    }

    /**
     * Invalidate the catalog cache (call after character import)
     */
    invalidateCatalog() {
        this._catalogCache = null;
        this._catalogPromise = null;
    }

    /**
     * Error handler wrapper
     * @param {Object} xhr - jQuery XHR object
     * @param {string} defaultMessage - Default error message
     */
    handleError(xhr, defaultMessage) {
        let message = defaultMessage;

        // Try to extract error message from response
        if (xhr.responseJSON && xhr.responseJSON.message) {
            message = xhr.responseJSON.message;
        } else if (xhr.responseJSON && xhr.responseJSON.error) {
            message = xhr.responseJSON.error;
        } else if (xhr.responseText) {
            try {
                const response = JSON.parse(xhr.responseText);
                if (response.message) {
                    message = response.message;
                } else if (response.detail) {
                    message = response.detail;
                }
            } catch (e) {
                // Not JSON, use default message
            }
        }

        // Add status code if available
        if (xhr.status && xhr.status !== 0) {
            message = `${message} (${xhr.status})`;
        }

        this.showError(message);
    }

    /**
     * Show error toast notification
     * @param {string} message - Error message to display
     */
    showError(message) {
        // Remove any existing error toasts
        $('.error-toast').remove();

        // Create new error toast
        const $toast = $('<div class="error-toast"></div>').text(message);
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, 5000);

        // Allow manual dismiss by clicking
        $toast.on('click', () => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }

    /**
     * Show success toast notification
     * @param {string} message - Success message to display
     */
    showSuccess(message) {
        // Remove any existing success toasts
        $('.success-toast').remove();

        // Create new success toast
        const $toast = $('<div class="success-toast"></div>').text(message);
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, 3000);

        // Allow manual dismiss by clicking
        $toast.on('click', () => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }

    /**
     * Show info toast notification
     * @param {string} message - Info message to display
     */
    showInfo(message) {
        // Remove any existing info toasts
        $('.info-toast').remove();

        // Create new info toast
        const $toast = $('<div class="info-toast"></div>').text(message);
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss after 4 seconds
        setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, 4000);

        // Allow manual dismiss by clicking
        $toast.on('click', () => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }
}

// Global API client instance
const api = new ApiClient();

// Export for ES6 modules
export default api;

// Also make available globally for non-module scripts
window.api = api;
