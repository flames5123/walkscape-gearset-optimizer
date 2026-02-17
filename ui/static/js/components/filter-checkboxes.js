/**
 * FilterCheckboxes Component
 * 
 * Manages filter checkboxes for gear selection popup.
 * 
 * Features:
 * - "Only show owned items" checkbox (functional)
 * - "Only show items with applicable stats" checkbox (placeholder for Column 3)
 * - Both checked by default
 * - States persisted to session via state store
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import Component from './base.js';
import store from '../state.js';

class FilterCheckboxes extends Component {
    /**
     * Create filter checkboxes component
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // Subscribe to checkbox state changes
        this.subscribe('ui.column2.showOwnedOnly', () => this.render());
        this.subscribe('ui.column2.showApplicableOnly', () => this.render());

        this.render();
        this.attachEvents();
    }

    /**
     * Toggle "Only show owned items" checkbox
     * Requirements: 2.2
     */
    toggleShowOwnedOnly() {
        const currentValue = store.state.ui.column2.showOwnedOnly;
        store.update('ui.column2.showOwnedOnly', !currentValue);
    }

    /**
     * Toggle "Only show items with applicable stats" checkbox
     * Requirements: 2.3
     */
    toggleShowApplicableOnly() {
        const currentValue = store.state.ui.column2.showApplicableOnly;
        store.update('ui.column2.showApplicableOnly', !currentValue);
    }

    /**
     * Render the component
     * Requirements: 2.1, 2.2, 2.3
     */
    render() {
        const showOwnedOnly = store.state.ui.column2.showOwnedOnly;
        const showApplicableOnly = store.state.ui.column2.showApplicableOnly;

        const html = `
            <div class="filter-checkboxes">
                <label class="filter-checkbox-label">
                    <input 
                        type="checkbox" 
                        class="filter-checkbox" 
                        id="show-owned-only"
                        ${showOwnedOnly ? 'checked' : ''}
                    />
                    <span>Only show owned items</span>
                </label>
                <label class="filter-checkbox-label">
                    <input 
                        type="checkbox" 
                        class="filter-checkbox" 
                        id="show-applicable-only"
                        ${showApplicableOnly ? 'checked' : ''}
                    />
                    <span>Only show items with applicable stats (NOT WORKING)</span>
                </label>
            </div>
        `;

        this.$element.html(html);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // "Only show owned items" checkbox
        this.$element.on('change', '#show-owned-only', () => {
            this.toggleShowOwnedOnly();
        });

        // "Only show items with applicable stats" checkbox
        this.$element.on('change', '#show-applicable-only', () => {
            this.toggleShowApplicableOnly();
        });
    }
}

export default FilterCheckboxes;
