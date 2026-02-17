/**
 * Keyboard Navigation Utility
 * 
 * Provides arrow key navigation and enter key selection for dropdown lists.
 * 
 * Features:
 * - Arrow Up/Down to navigate through items
 * - Enter to select highlighted item
 * - Auto-select if only one match
 * - Special handling for category headers (expand/collapse on Enter)
 * - Scroll highlighted item into view
 */

class KeyboardNavigator {
    /**
     * Create a keyboard navigator
     * @param {jQuery} $container - Container element with the list
     * @param {Object} options - Configuration options
     * @param {string} options.itemSelector - Selector for selectable items
     * @param {string} options.categorySelector - Selector for category headers (optional)
     * @param {Function} options.onSelect - Callback when item is selected
     * @param {Function} options.onCategoryToggle - Callback when category is toggled (optional)
     * @param {Function} options.getVisibleItems - Function to get currently visible items
     */
    constructor($container, options = {}) {
        this.$container = $container;
        this.itemSelector = options.itemSelector || '.item';
        this.categorySelector = options.categorySelector || null;
        this.onSelect = options.onSelect || (() => { });
        this.onCategoryToggle = options.onCategoryToggle || null;
        this.getVisibleItems = options.getVisibleItems || (() => this.$container.find(this.itemSelector));

        this.highlightedIndex = -1;
        this.attached = false;

        // Generate unique ID for this navigator instance
        this.instanceId = 'keyboard-nav-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Attach keyboard event handlers
     */
    attach() {
        if (this.attached) return;

        // Attach to document with unique namespace to capture all keyboard events
        $(document).on(`keydown.${this.instanceId}`, (e) => {
            // Only handle if the container or its descendants have focus
            if (!this.$container.is(':visible')) return;

            // Check if we're in the right context (container or search input within container)
            const $target = $(e.target);
            const isInContainer = $target.closest(this.$container).length > 0;

            if (!isInContainer) return;

            this.handleKeyDown(e);
        });
        this.attached = true;
    }

    /**
     * Detach keyboard event handlers
     */
    detach() {
        if (!this.attached) return;

        $(document).off(`keydown.${this.instanceId}`);
        this.attached = false;
        this.clearHighlight();
    }

    /**
     * Handle keydown events
     * @param {Event} e - Keyboard event
     */
    handleKeyDown(e) {
        const $visibleItems = this.getVisibleItems();

        console.log('KeyboardNavigator: handleKeyDown', {
            key: e.key,
            visibleItemsCount: $visibleItems.length,
            currentIndex: this.highlightedIndex
        });

        // If only one item and Enter is pressed, select it immediately
        if (e.key === 'Enter' && $visibleItems.length === 1) {
            e.preventDefault();
            const $item = $visibleItems.first();

            // Check if it's a category header
            if (this.categorySelector && $item.is(this.categorySelector)) {
                if (this.onCategoryToggle) {
                    this.onCategoryToggle($item);
                }
            } else {
                this.onSelect($item);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.moveHighlight(1, $visibleItems);
                break;

            case 'ArrowUp':
                e.preventDefault();
                this.moveHighlight(-1, $visibleItems);
                break;

            case 'Enter':
                e.preventDefault();
                if (this.highlightedIndex >= 0 && this.highlightedIndex < $visibleItems.length) {
                    const $item = $visibleItems.eq(this.highlightedIndex);

                    // Check if it's a category header
                    if (this.categorySelector && $item.is(this.categorySelector)) {
                        if (this.onCategoryToggle) {
                            this.onCategoryToggle($item);
                        }
                    } else {
                        this.onSelect($item);
                    }
                }
                break;

            case 'Escape':
                e.preventDefault();
                this.clearHighlight();
                break;
        }
    }

    /**
     * Move highlight up or down
     * @param {number} direction - 1 for down, -1 for up
     * @param {jQuery} $visibleItems - Currently visible items
     */
    moveHighlight(direction, $visibleItems) {
        console.log('KeyboardNavigator: moveHighlight', {
            direction,
            itemsCount: $visibleItems.length,
            currentIndex: this.highlightedIndex
        });

        if ($visibleItems.length === 0) return;

        // Save current index before clearing
        const oldIndex = this.highlightedIndex;

        // Clear current highlight (removes CSS class only)
        this.$container.find('.keyboard-highlighted').removeClass('keyboard-highlighted');

        // Calculate new index
        if (oldIndex === -1) {
            // No item highlighted yet
            this.highlightedIndex = direction > 0 ? 0 : $visibleItems.length - 1;
        } else {
            this.highlightedIndex = oldIndex + direction;

            // Wrap around
            if (this.highlightedIndex < 0) {
                this.highlightedIndex = $visibleItems.length - 1;
            } else if (this.highlightedIndex >= $visibleItems.length) {
                this.highlightedIndex = 0;
            }
        }

        console.log('KeyboardNavigator: new index', this.highlightedIndex);

        // Apply highlight
        const $item = $visibleItems.eq(this.highlightedIndex);
        console.log('KeyboardNavigator: highlighting item', $item[0]);
        $item.addClass('keyboard-highlighted');

        // Scroll into view
        this.scrollIntoView($item);
    }

    /**
     * Clear all highlights
     */
    clearHighlight() {
        this.$container.find('.keyboard-highlighted').removeClass('keyboard-highlighted');
        this.highlightedIndex = -1;
    }

    /**
     * Scroll highlighted item into view
     * @param {jQuery} $item - Item to scroll to
     */
    scrollIntoView($item) {
        if (!$item.length) return;

        const container = this.$container[0];
        const item = $item[0];

        if (!container || !item) return;

        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();

        // Check if item is above visible area
        if (itemRect.top < containerRect.top) {
            container.scrollTop -= (containerRect.top - itemRect.top);
        }
        // Check if item is below visible area
        else if (itemRect.bottom > containerRect.bottom) {
            container.scrollTop += (itemRect.bottom - containerRect.bottom);
        }
    }

    /**
     * Reset navigation state (call when list content changes)
     */
    reset() {
        this.clearHighlight();
    }
}

export default KeyboardNavigator;
