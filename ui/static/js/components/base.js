/**
 * Base Component class for all UI components
 * 
 * Provides common functionality:
 * - jQuery element wrapping
 * - State subscription management
 * - Lifecycle methods
 */

import store from '../state.js';

class Component {
    /**
     * Create a new component
     * @param {HTMLElement|string} element - DOM element or selector
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        // Store jQuery-wrapped element for easy DOM manipulation
        this.$element = $(element);
        this.props = props;
        this.subscriptions = [];
    }

    /**
     * Subscribe to state changes at a specific path
     * @param {string} path - State path to watch (e.g., "items.TRAVELERS_KIT")
     * @param {Function} callback - Function to call when state changes
     */
    subscribe(path, callback) {
        const unsub = store.subscribe(path, callback.bind(this));
        this.subscriptions.push(unsub);
    }

    /**
     * Clean up subscriptions and DOM
     * Call this when removing a component
     */
    destroy() {
        // Unsubscribe from all state changes
        this.subscriptions.forEach(unsub => unsub());
        this.subscriptions = [];

        // Clear DOM content
        this.$element.empty();
    }

    /**
     * Render component (override in subclass)
     * @returns {string} HTML string to render
     */
    render() {
        // Subclasses should implement this
        return '';
    }

    /**
     * Update DOM with current render output
     * Uses jQuery to update the element's HTML
     */
    update() {
        const html = this.render();
        this.$element.html(html);
    }
}

export default Component;
