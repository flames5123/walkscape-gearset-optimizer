/**
 * ReputationSection component
 * 
 * Displays faction reputation in a 3-column grid with editable reputation fields.
 * 
 * Features:
 * - Collapsible section (expanded by default)
 * - 3-column grid layout for factions
 * - Faction rows with icon, name, and editable reputation
 * - Input validation (0-999 for reputation)
 * - State updates on value changes
 */

import CollapsibleSection from './collapsible.js';
import store from '../state.js';

class ReputationSection extends CollapsibleSection {
    /**
     * Create a Faction Reputation section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties (optional)
     */
    constructor(element, props = {}) {
        // Initialize with collapsible section properties
        super(element, {
            title: 'Faction Reputation',
            icon: '/assets/icons/text/general_icons/reputation.svg',
            count: '',
            defaultExpanded: true
        });

        // Define factions in display order (3-column grid)
        this.factions = [
            { id: 'herberts_guiding_grounds', display_name: "Herbert's Guiding Grounds" },
            { id: 'jarvonia', display_name: 'Jarvonia' },
            { id: 'erdwise', display_name: 'Erdwise' },
            { id: 'trellin', display_name: 'Trellin' },
            { id: 'halfling_rebels', display_name: 'Halfling Rebels' },
            { id: 'syrenthia', display_name: 'Syrenthia' }
        ];

        // Don't subscribe to state changes - inputs are already bound via event handlers
        // This prevents unnecessary re-renders when typing

        // Initial render
        this.render();
        this.attachEvents();
    }

    /**
     * Render the content inside the collapsible section
     * @returns {string} HTML string for content area
     */
    renderContent() {
        // Defensive check - if factions isn't set yet, return empty
        if (!this.factions) {
            return '<div class="reputation-section-content">Loading...</div>';
        }

        const character = store.state.character || {};
        const overrides = store.state.ui.user_overrides || {};

        // Helper to get reputation with proper fallback
        const getReputation = (factionId) => {
            if (overrides.reputation && overrides.reputation[factionId] !== undefined) {
                return overrides.reputation[factionId];
            }
            return character.reputation?.[factionId] || 0;
        };

        let html = '<div class="reputation-section-content">';
        html += '<div class="reputation-grid">';

        // Render each faction
        this.factions.forEach(faction => {
            const repValue = getReputation(faction.id);
            html += this.renderFactionRow(faction, repValue);
        });

        html += '</div>';
        html += '</div>';

        return html;
    }

    /**
     * Render a single faction row
     * @param {Object} faction - Faction definition
     * @param {number} repValue - Current reputation value
     * @returns {string} HTML string for faction row
     */
    renderFactionRow(faction, repValue) {
        // Show only integer value for reputation
        const intValue = Math.floor(repValue);

        return `
            <div class="faction-row" data-faction="${faction.id}">
                <img src="/assets/icons/factions/${faction.id}.svg" 
                     class="faction-icon" 
                     alt="${faction.display_name}"
                     title="${faction.display_name}"
                     onerror="this.style.display='none'">
                <input type="number" 
                       class="reputation-input" 
                       value="${intValue}" 
                       min="0" 
                       max="999"
                       step="1"
                       data-faction="${faction.id}"
                       title="${faction.display_name}">
            </div>
        `;
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Call parent to handle collapsible header
        super.attachEvents();

        // Handle reputation changes - store as user override
        this.$element.on('change', '.reputation-input', (e) => {
            const $input = $(e.target);
            const factionId = $input.data('faction');
            let value = parseInt($input.val(), 10);

            // Validate reputation (0-999)
            if (isNaN(value) || value < 0) {
                value = 0;
                $input.val(0);
            } else if (value > 999) {
                value = 999;
                $input.val(999);
            }

            // Store as user override in ui_config
            store.update(`ui.user_overrides.reputation.${factionId}`, value);
        });

        // Handle input validation on blur (when user leaves field)
        this.$element.on('blur', '.reputation-input', (e) => {
            const $input = $(e.target);
            let value = parseInt($input.val(), 10);

            // Validate reputation (0-999)
            if (isNaN(value) || value < 0) {
                value = 0;
            } else if (value > 999) {
                value = 999;
            }

            $input.val(value);
        });
    }

}

export default ReputationSection;
