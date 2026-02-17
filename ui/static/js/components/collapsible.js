/**
 * CollapsibleSection component
 * 
 * A section that can be expanded/collapsed with smooth animations.
 * Features:
 * - Header with icon, title, and count
 * - Expand/collapse arrow indicator
 * - Smooth jQuery slideToggle animation
 * - Customizable default state (expanded/collapsed)
 */

import Component from './base.js';

class CollapsibleSection extends Component {
    /**
     * Create a collapsible section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {string} props.title - Section title
     * @param {string} props.icon - Icon URL/path
     * @param {string} props.count - Count display (e.g., "5/10")
     * @param {boolean} props.defaultExpanded - Whether to start expanded (default: true)
     */
    constructor(element, { title, icon, count, defaultExpanded = true, ...otherProps }) {
        // Pass all props to parent, including any extras
        super(element, { title, icon, count, defaultExpanded, ...otherProps });
        this.expanded = defaultExpanded;
        this.render();
        this.attachEvents();
    }

    /**
     * Render the collapsible section HTML
     * @returns {string} HTML string
     */
    render() {
        const html = `
            <div class="collapsible ${this.expanded ? 'expanded' : ''}">
                <div class="collapsible-header">
                    <span class="title">${this.props.title}</span>
                    <span class="count">${this.props.count}</span>
                    <span class="expand-arrow ${this.expanded ? 'expanded' : ''}">▼</span>
                </div>
                <div class="collapsible-content" style="display: ${this.expanded ? 'block' : 'none'}">
                    ${this.renderContent()}
                </div>
            </div>
        `;
        this.$element.html(html);
        return html;
    }

    /**
     * Render the content inside the collapsible section
     * Override this in subclasses to provide custom content
     * @returns {string} HTML string for content area
     */
    renderContent() {
        // Subclasses should override this
        return '';
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Remove any existing handlers to prevent duplicates
        this.$element.off('click', '.collapsible-header');

        // Use jQuery event delegation for the header click
        this.$element.on('click', '.collapsible-header', () => {
            this.toggle();
        });
    }

    /**
     * Toggle the expanded/collapsed state with smooth animation
     */
    toggle() {
        const $content = this.$element.find('.collapsible-content');
        // Only target the arrow in the collapsible header, not nested arrows
        const $arrow = this.$element.find('.collapsible-header > .expand-arrow');

        // Check current visibility state (not the boolean, but actual DOM state)
        const isCurrentlyVisible = $content.is(':visible');

        // Toggle based on current visibility
        if (isCurrentlyVisible) {
            // Currently visible, so hide it
            this.expanded = false;
            $arrow.removeClass('expanded');
            $content.slideUp(200);
        } else {
            // Currently hidden, so show it
            this.expanded = true;
            $arrow.addClass('expanded');
            $content.slideDown(200);

            // If this is OwnedItemsSection, initialize items when expanded
            if (typeof this.initializeItemRows === 'function') {
                setTimeout(() => {
                    this.initializeItemRows();
                }, 250); // Wait for animation to complete
            }
        }

        // Update the expanded class
        this.$element.find('.collapsible').toggleClass('expanded', this.expanded);
    }

    /**
     * Update the count display
     * @param {string} newCount - New count string (e.g., "7/10")
     */
    updateCount(newCount) {
        this.props.count = newCount;
        this.$element.find('.count').text(newCount);
    }
}

export default CollapsibleSection;
