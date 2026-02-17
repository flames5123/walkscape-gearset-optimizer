/**
 * Undo/Redo Manager for Gearset Changes
 * 
 * Tracks gearset state changes and provides undo/redo functionality.
 * Only tracks changes to gearsets.current (equipped gear).
 * 
 * Features:
 * - Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo)
 * - UI buttons in bottom right corner
 * - Tracks all gear slot changes
 * - Handles unequip all, import, and individual slot changes
 * - Maximum history size to prevent memory issues
 */

class UndoRedoManager {
    constructor() {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = 50;
        this.isApplyingState = false;
        this.initialized = false;

        // Set up keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    /**
     * Capture current gearset state
     * @returns {Object} Deep copy of current gearset
     */
    captureState() {
        const currentGear = window.store.state.gearsets?.current || {};

        // Deep copy the gearset
        const state = {};
        for (const [slot, item] of Object.entries(currentGear)) {
            if (item) {
                state[slot] = { ...item };
            } else {
                state[slot] = null;
            }
        }

        return state;
    }

    /**
     * Generate a description of changes between two states
     * @param {Object} fromState - Previous state
     * @param {Object} toState - New state
     * @returns {string} Human-readable description of changes
     */
    describeChanges(fromState, toState) {
        const changes = [];

        // Get all slots from both states
        const allSlots = new Set([
            ...Object.keys(fromState),
            ...Object.keys(toState)
        ]);

        // Slot display names
        const slotNames = {
            'head': 'Head', 'cape': 'Cape', 'back': 'Back',
            'hands': 'Hands', 'chest': 'Chest', 'neck': 'Neck',
            'primary': 'Primary', 'legs': 'Legs', 'secondary': 'Secondary',
            'ring1': 'Ring 1', 'ring2': 'Ring 2', 'feet': 'Feet',
            'tool0': 'Tool 1', 'tool1': 'Tool 2', 'tool2': 'Tool 3',
            'tool3': 'Tool 4', 'tool4': 'Tool 5', 'tool5': 'Tool 6',
            'consumable': 'Consumable', 'pet': 'Pet'
        };

        for (const slot of allSlots) {
            const fromItem = fromState[slot];
            const toItem = toState[slot];
            const slotName = slotNames[slot] || slot;

            // Item was removed
            if (fromItem && !toItem) {
                changes.push(`Unequipped ${slotName}`);
            }
            // Item was added
            else if (!fromItem && toItem) {
                changes.push(`Equipped ${toItem.name} in ${slotName}`);
            }
            // Item was changed
            else if (fromItem && toItem && fromItem.uuid !== toItem.uuid) {
                changes.push(`${slotName}: ${fromItem.name} → ${toItem.name}`);
            }
            // Quality changed (same item, different quality)
            else if (fromItem && toItem && fromItem.uuid === toItem.uuid && fromItem.quality !== toItem.quality) {
                changes.push(`${slotName}: ${fromItem.quality || 'Normal'} → ${toItem.quality || 'Normal'}`);
            }
        }

        if (changes.length === 0) {
            return 'No changes';
        }

        if (changes.length === 1) {
            return changes[0];
        }

        if (changes.length <= 3) {
            return changes.join(', ');
        }

        // More than 3 changes - show count and first few
        return `${changes.length} changes: ${changes.slice(0, 2).join(', ')}, ...`;
    }

    /**
     * Generate a description of a state for tooltips
     * @param {Object} state - State to describe
     * @returns {string} Human-readable description
     */
    describeState(state) {
        const equippedItems = Object.entries(state)
            .filter(([slot, item]) => item !== null)
            .map(([slot, item]) => item.name);

        if (equippedItems.length === 0) {
            return 'Empty gearset';
        }

        if (equippedItems.length === 1) {
            return `1 item: ${equippedItems[0]}`;
        }

        if (equippedItems.length <= 3) {
            return `${equippedItems.length} items: ${equippedItems.join(', ')}`;
        }

        return `${equippedItems.length} items equipped`;
    }

    /**
     * Get tooltip text for undo button
     * @returns {string} Tooltip text
     */
    getUndoTooltip() {
        if (!this.canUndo()) {
            return 'Undo (Ctrl/Cmd+Z) - No changes to undo';
        }

        const currentState = this.history[this.currentIndex];
        const previousState = this.history[this.currentIndex - 1];
        // Describe what will be undone: changes FROM previous TO current
        const changes = this.describeChanges(previousState, currentState);
        return `Undo: ${changes} (Ctrl/Cmd+Z)`;
    }

    /**
     * Get tooltip text for redo button
     * @returns {string} Tooltip text
     */
    getRedoTooltip() {
        if (!this.canRedo()) {
            return 'Redo (Ctrl/Cmd+Shift+Z) - No changes to redo';
        }

        const currentState = this.history[this.currentIndex];
        const nextState = this.history[this.currentIndex + 1];
        // Describe what will be redone: changes FROM current TO next
        const changes = this.describeChanges(currentState, nextState);
        return `Redo: ${changes} (Ctrl/Cmd+Shift+Z)`;
    }

    /**
     * Push a new state to history
     * Called after any gearset change
     */
    pushState() {
        // Don't push if we're applying a state (undo/redo)
        if (this.isApplyingState) {
            return;
        }

        const newState = this.captureState();

        // Check if state actually changed
        if (this.currentIndex >= 0 && this.statesEqual(newState, this.history[this.currentIndex])) {
            console.log('Undo/Redo: State unchanged, not pushing');
            return;
        }

        // Remove any states after current index (if we undid and then made a new change)
        this.history = this.history.slice(0, this.currentIndex + 1);

        // Add new state
        this.history.push(newState);
        this.currentIndex++;

        // Trim history if too large
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex--;
        }

        // Update button states
        this.updateButtons();

        console.log('Undo/Redo: Pushed state', {
            historyLength: this.history.length,
            currentIndex: this.currentIndex,
            equippedSlots: Object.keys(newState).filter(k => newState[k]).length
        });
    }

    /**
     * Compare two states for equality
     * @param {Object} state1 - First state
     * @param {Object} state2 - Second state
     * @returns {boolean} True if states are equal
     */
    statesEqual(state1, state2) {
        const slots1 = Object.keys(state1).sort();
        const slots2 = Object.keys(state2).sort();

        if (slots1.length !== slots2.length) {
            return false;
        }

        for (const slot of slots1) {
            const item1 = state1[slot];
            const item2 = state2[slot];

            // Both null
            if (!item1 && !item2) {
                continue;
            }

            // One null, one not
            if (!item1 || !item2) {
                return false;
            }

            // Compare UUIDs (unique identifier)
            if (item1.uuid !== item2.uuid) {
                return false;
            }

            // Compare quality for crafted items
            if (item1.quality !== item2.quality) {
                return false;
            }
        }

        return true;
    }

    /**
     * Apply a state to the store
     * @param {Object} state - State to apply
     */
    applyState(state) {
        this.isApplyingState = true;

        // Save scroll position before applying state
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        try {
            // Get current gear to compare
            const currentGear = window.store.state.gearsets?.current || {};

            // Get all possible slots
            const allSlots = [
                'head', 'cape', 'back', 'hands', 'chest', 'neck',
                'primary', 'legs', 'secondary', 'ring1', 'ring2', 'feet',
                'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5',
                'consumable', 'pet'
            ];

            // Update each slot directly without triggering individual notifications
            let hasChanges = false;
            for (const slot of allSlots) {
                const newItem = state[slot] || null;
                const currentItem = currentGear[slot] || null;

                // Check if slot actually changed
                const itemChanged = JSON.stringify(newItem) !== JSON.stringify(currentItem);

                if (itemChanged) {
                    hasChanges = true;
                    // Update state directly without notification
                    window.store.state.gearsets.current[slot] = newItem;
                }
            }

            // Notify subscribers once after all changes
            if (hasChanges) {
                window.store._notifySubscribers('gearsets.current');
                window.store._saveCurrentGear();
            }

            console.log('Undo/Redo: Applied state', state);

            // Restore scroll position after state is applied
            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        } finally {
            this.isApplyingState = false;
        }
    }

    /**
     * Undo the last change
     */
    undo() {
        if (!this.canUndo()) {
            console.log('Undo/Redo: Cannot undo (at beginning of history)');
            return;
        }

        this.currentIndex--;
        const state = this.history[this.currentIndex];
        this.applyState(state);
        this.updateButtons();

        console.log('Undo/Redo: Undid to index', this.currentIndex);
    }

    /**
     * Redo the last undone change
     */
    redo() {
        if (!this.canRedo()) {
            console.log('Undo/Redo: Cannot redo (at end of history)');
            return;
        }

        this.currentIndex++;
        const state = this.history[this.currentIndex];
        this.applyState(state);
        this.updateButtons();

        console.log('Undo/Redo: Redid to index', this.currentIndex);
    }

    /**
     * Check if undo is available
     * @returns {boolean} True if can undo
     */
    canUndo() {
        return this.currentIndex > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean} True if can redo
     */
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    /**
     * Update button states (enabled/disabled) and tooltips
     */
    updateButtons() {
        const $undoBtn = $('#undo-btn');
        const $redoBtn = $('#redo-btn');

        if ($undoBtn.length) {
            $undoBtn.prop('disabled', !this.canUndo());
            $undoBtn.attr('title', this.getUndoTooltip());
        }

        if ($redoBtn.length) {
            $redoBtn.prop('disabled', !this.canRedo());
            $redoBtn.attr('title', this.getRedoTooltip());
        }
    }

    /**
     * Set up keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        $(document).on('keydown', (e) => {
            // Check for Ctrl/Cmd+Z (undo)
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                this.undo();
                return false;
            }

            // Check for Ctrl/Cmd+Shift+Z (redo)
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                this.redo();
                return false;
            }
        });
    }

    /**
     * Initialize with current state (call after session loads)
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        // Capture initial state
        const initialState = this.captureState();
        this.history.push(initialState);
        this.currentIndex = 0;
        this.initialized = true;

        // Update button states
        this.updateButtons();

        console.log('Undo/Redo: Initialized with state', {
            historyLength: this.history.length,
            currentIndex: this.currentIndex,
            state: initialState
        });
    }

    /**
     * Subscribe to gearset changes
     */
    subscribeToChanges() {
        // Subscribe to any gearset.current changes
        window.store.subscribe('gearsets.current', () => {
            // Skip if not initialized yet (will be initialized explicitly)
            if (!this.initialized) {
                console.log('Undo/Redo: Skipping change (not initialized yet)');
                return;
            }

            // Use setTimeout to batch rapid changes (increased to 300ms)
            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 300);
        });
    }
}

// Create global instance
const undoRedoManager = new UndoRedoManager();

// Export for ES6 modules
export default undoRedoManager;

// Also make available globally
window.undoRedoManager = undoRedoManager;
