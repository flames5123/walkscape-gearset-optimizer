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

        // Observers called whenever the history or current index changes.
        // Used by the UI to keep an open history popup in sync with
        // undo/redo/jump/push actions.
        this._changeObservers = [];

        // Set up keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    /**
     * Subscribe to history changes. The callback is invoked after any
     * undo/redo/jump/push, i.e. whenever the list or currentIndex may
     * have moved.
     * @param {Function} cb
     * @returns {Function} Unsubscribe function
     */
    onChange(cb) {
        this._changeObservers.push(cb);
        return () => {
            const i = this._changeObservers.indexOf(cb);
            if (i >= 0) this._changeObservers.splice(i, 1);
        };
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

        // Capture per-slot lock state
        state._lockedSlots = { ...(window.store.state.gearsets?.lockedSlots || {}) };

        // Capture alternatives state (so undo restores them after equipping an alternative)
        state._alternatives = window.store.state.gearsets?.alternatives || null;
        state._lockedAlternatives = window.store.state.gearsets?.lockedAlternatives || null;

        // Capture activity/recipe selection
        const col3 = window.store.state.column3 || {};
        state._column3 = {
            selectedActivity: col3.selectedActivity || null,
            selectedRecipe: col3.selectedRecipe || null
        };

        // Capture gearset2 state when in comparison mode
        if (window.store.state.gearsets?.comparisonMode) {
            const gearset2 = window.store.state.gearsets?.gearset2 || {};
            const gs2 = {};
            for (const [slot, item] of Object.entries(gearset2)) {
                gs2[slot] = item ? { ...item } : null;
            }
            state._gearset2 = gs2;
            state._gearset2LockedSlots = { ...(window.store.state.gearsets?.gearset2LockedSlots || {}) };
        }

        // Capture crafting tree state
        const ctNodes = window.store.state.ui?.crafting_tree?.nodes;
        if (ctNodes && ctNodes.length > 0) {
            state._craftingTreeNodes = JSON.parse(JSON.stringify(ctNodes));
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

            // Skip internal keys
            if (slot.startsWith('_')) continue;

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

        // Describe lock changes
        const fromLocked = fromState._lockedSlots || {};
        const toLocked = toState._lockedSlots || {};
        for (const slot of Object.keys(toLocked)) {
            if (!fromLocked[slot]) {
                const slotName = slotNames[slot] || slot;
                changes.push(`Locked ${slotName}`);
            }
        }
        for (const slot of Object.keys(fromLocked)) {
            if (!toLocked[slot]) {
                const slotName = slotNames[slot] || slot;
                changes.push(`Unlocked ${slotName}`);
            }
        }

        // Describe activity/recipe selection changes
        const fromCol3 = fromState._column3 || {};
        const toCol3 = toState._column3 || {};
        if (fromCol3.selectedActivity !== toCol3.selectedActivity) {
            if (toCol3.selectedActivity) {
                changes.push(`Selected activity: ${toCol3.selectedActivity}`);
            } else if (fromCol3.selectedActivity) {
                changes.push(`Cleared activity`);
            }
        }
        if (fromCol3.selectedRecipe !== toCol3.selectedRecipe) {
            if (toCol3.selectedRecipe) {
                changes.push(`Selected recipe: ${toCol3.selectedRecipe}`);
            } else if (fromCol3.selectedRecipe) {
                changes.push(`Cleared recipe`);
            }
        }

        // Describe crafting tree changes
        const fromCT = fromState._craftingTreeNodes || [];
        const toCT = toState._craftingTreeNodes || [];
        if (fromCT.length !== toCT.length) {
            changes.push(`Crafting tree: ${fromCT.length} → ${toCT.length} nodes`);
        } else if (fromCT.length > 0) {
            for (let i = 0; i < toCT.length; i++) {
                const n1 = fromCT[i], n2 = toCT[i];
                if (!n1 || !n2) continue;
                if (n1.source_type !== n2.source_type || n1.source_id !== n2.source_id) {
                    changes.push(`${n2.item_name}: source changed`);
                    break;
                }
                if (n1.selected_service_id !== n2.selected_service_id) {
                    changes.push(`${n2.item_name}: service changed`);
                    break;
                }
                if (n1.selected_location_id !== n2.selected_location_id) {
                    changes.push(`${n2.item_name}: location changed`);
                    break;
                }
                if (n1.selected_material_group_index !== n2.selected_material_group_index) {
                    changes.push(`${n2.item_name}: materials changed`);
                    break;
                }
                if (!!n1._mo_preview_active !== !!n2._mo_preview_active) {
                    changes.push(n2._mo_preview_active
                        ? `${n2.item_name}: previewed alternative recipe`
                        : `${n2.item_name}: cleared recipe preview`);
                    break;
                }
                if ((n1.gear_config?.optimized_export || null) !== (n2.gear_config?.optimized_export || null)) {
                    changes.push(`${n2.item_name}: gearset updated`);
                    break;
                }
                // Per-slot lock changes (popup pick / unequip / lock-toggle).
                // Find which slot moved and produce a friendly description so
                // the undo/redo dropdown shows e.g. "Iron Sickle: locked
                // primary" instead of "no changes".
                const lock1 = n1.locked_slots || {};
                const lock2 = n2.locked_slots || {};
                const allLockSlots = new Set([...Object.keys(lock1), ...Object.keys(lock2)]);
                let lockDesc = null;
                for (const sl of allLockSlots) {
                    const a = lock1[sl];
                    const b = lock2[sl];
                    const aId = (a && typeof a === 'object') ? a.itemId : null;
                    const bId = (b && typeof b === 'object') ? b.itemId : null;
                    const aName = (a && typeof a === 'object') ? (a.name || aId) : null;
                    const bName = (b && typeof b === 'object') ? (b.name || bId) : null;
                    // Null sentinel means user-unequipped (force-empty).
                    const aUnequipped = (a === null);
                    const bUnequipped = (b === null);
                    if (a === undefined && b !== undefined) {
                        lockDesc = bUnequipped
                            ? `${n2.item_name}: unequipped ${sl}`
                            : `${n2.item_name}: locked ${sl} → ${bName || sl}`;
                        break;
                    }
                    if (a !== undefined && b === undefined) {
                        lockDesc = aUnequipped
                            ? `${n2.item_name}: re-equipped ${sl}`
                            : `${n2.item_name}: unlocked ${sl}`;
                        break;
                    }
                    if (aId !== bId || aUnequipped !== bUnequipped) {
                        if (bUnequipped) {
                            lockDesc = `${n2.item_name}: unequipped ${sl}`;
                        } else if (aUnequipped) {
                            lockDesc = `${n2.item_name}: equipped ${bName || sl}`;
                        } else {
                            lockDesc = `${n2.item_name}: ${sl} → ${bName || sl}`;
                        }
                        break;
                    }
                }
                if (lockDesc) {
                    changes.push(lockDesc);
                    break;
                }
                // Activity input pin changes (arrows / plant / fabric / ...).
                const ui1 = n1.gear_config?.user_input_items || {};
                const ui2 = n2.gear_config?.user_input_items || {};
                const allUiKeys = new Set([...Object.keys(ui1), ...Object.keys(ui2)]);
                let uiDesc = null;
                for (const k of allUiKeys) {
                    const a = ui1[k];
                    const b = ui2[k];
                    const aId = a && a.itemId;
                    const bId = b && b.itemId;
                    if (aId !== bId) {
                        if (!b) {
                            uiDesc = `${n2.item_name}: cleared input`;
                        } else if (!a) {
                            uiDesc = `${n2.item_name}: input → ${b.name || bId || ''}`;
                        } else {
                            uiDesc = `${n2.item_name}: input ${a.name || aId} → ${b.name || bId}`;
                        }
                        break;
                    }
                }
                if (uiDesc) {
                    changes.push(uiDesc);
                    break;
                }
                // Lock-conflict warning toggle (yellow triangle box).
                if ((n1.gear_config?.lock_warning || null) !== (n2.gear_config?.lock_warning || null)) {
                    changes.push(n2.gear_config?.lock_warning
                        ? `${n2.item_name}: lock-conflict warning raised`
                        : `${n2.item_name}: lock-conflict warning cleared`);
                    break;
                }
                // Bank quantity tweaks.
                if ((n1.banked_quantity || 0) !== (n2.banked_quantity || 0)) {
                    changes.push(`${n2.item_name}: banked qty ${n1.banked_quantity || 0} → ${n2.banked_quantity || 0}`);
                    break;
                }
                // Gear preview open/close toggle — small action but the
                // user explicitly asked for "everything in the tree" to
                // be undoable, so describe it too.
                if (!!n1.gear_preview_open !== !!n2.gear_preview_open) {
                    changes.push(n2.gear_preview_open
                        ? `${n2.item_name}: opened gear preview`
                        : `${n2.item_name}: closed gear preview`);
                    break;
                }
            }
        }

        // Describe gearset2 changes
        const fromGs2 = fromState._gearset2 || {};
        const toGs2 = toState._gearset2 || {};
        const allGs2Slots = new Set([...Object.keys(fromGs2), ...Object.keys(toGs2)]);
        for (const slot of allGs2Slots) {
            const fromItem = fromGs2[slot];
            const toItem = toGs2[slot];
            const slotName = slotNames[slot] || slot;
            if (slot.startsWith('_')) continue;
            if (fromItem && !toItem) changes.push(`GS2 ${slotName}: unequipped`);
            else if (!fromItem && toItem) changes.push(`GS2 ${slotName}: ${toItem.name}`);
            else if (fromItem && toItem && fromItem.uuid !== toItem.uuid) changes.push(`GS2 ${slotName}: → ${toItem.name}`);
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
            .filter(([slot, item]) => item !== null && !slot.startsWith('_'))
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
        const slots1 = Object.keys(state1).filter(k => k !== '_lockedSlots').sort();
        const slots2 = Object.keys(state2).filter(k => k !== '_lockedSlots').sort();

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

        // Compare lockedSlots
        const locked1 = state1._lockedSlots || {};
        const locked2 = state2._lockedSlots || {};
        const lockedKeys1 = Object.keys(locked1).sort();
        const lockedKeys2 = Object.keys(locked2).sort();
        if (lockedKeys1.length !== lockedKeys2.length) return false;
        for (const key of lockedKeys1) {
            if (!locked2[key]) return false;
        }

        // Compare activity/recipe selection
        const col3_1 = state1._column3 || {};
        const col3_2 = state2._column3 || {};
        if (col3_1.selectedActivity !== col3_2.selectedActivity) return false;
        if (col3_1.selectedRecipe !== col3_2.selectedRecipe) return false;

        // Compare crafting tree nodes
        const ct1 = state1._craftingTreeNodes;
        const ct2 = state2._craftingTreeNodes;
        if (!!ct1 !== !!ct2) return false;
        if (ct1 && ct2) {
            if (ct1.length !== ct2.length) return false;
            for (let i = 0; i < ct1.length; i++) {
                const n1 = ct1[i], n2 = ct2[i];
                if (n1.node_id !== n2.node_id) return false;
                if (n1.source_type !== n2.source_type) return false;
                if (n1.source_id !== n2.source_id) return false;
                if (n1.selected_service_id !== n2.selected_service_id) return false;
                if (n1.selected_location_id !== n2.selected_location_id) return false;
                if (n1.selected_material_group_index !== n2.selected_material_group_index) return false;
                if (!!n1._mo_preview_active !== !!n2._mo_preview_active) return false;
                if ((n1.best_material_group_index ?? null) !== (n2.best_material_group_index ?? null)) return false;
                if (n1.banked_quantity !== n2.banked_quantity) return false;
                if ((n1.gear_config?.optimized_export || null) !== (n2.gear_config?.optimized_export || null)) return false;
                // Gear preview pin state — without these comparisons,
                // every popup pick / unequip / lock-toggle / input-pin
                // hits this dedupe and gets swallowed because none of
                // the fields above change. Just JSON-stringify the
                // sub-trees for a fast deep compare; they're small
                // (at most ~16 slot entries with short flat fields).
                const lock1 = JSON.stringify(n1.locked_slots || {});
                const lock2 = JSON.stringify(n2.locked_slots || {});
                if (lock1 !== lock2) return false;
                const ui1 = JSON.stringify(n1.gear_config?.user_input_items || {});
                const ui2 = JSON.stringify(n2.gear_config?.user_input_items || {});
                if (ui1 !== ui2) return false;
                const sii1 = JSON.stringify(n1.gear_config?.selected_input_items || {});
                const sii2 = JSON.stringify(n2.gear_config?.selected_input_items || {});
                if (sii1 !== sii2) return false;
                if ((n1.gear_config?.lock_warning || null) !== (n2.gear_config?.lock_warning || null)) return false;
                if (!!n1.gear_preview_open !== !!n2.gear_preview_open) return false;
            }
        }

        // Compare gearset2 if present in either state
        const gs2_1 = state1._gearset2;
        const gs2_2 = state2._gearset2;
        if (!!gs2_1 !== !!gs2_2) return false;
        if (gs2_1 && gs2_2) {
            const gs2slots1 = Object.keys(gs2_1).sort();
            const gs2slots2 = Object.keys(gs2_2).sort();
            if (gs2slots1.length !== gs2slots2.length) return false;
            for (const slot of gs2slots1) {
                const a = gs2_1[slot], b = gs2_2[slot];
                if (!a && !b) continue;
                if (!a || !b) return false;
                if (a.uuid !== b.uuid || a.quality !== b.quality) return false;
            }
            // Compare gearset2 locks
            const gl1 = state1._gearset2LockedSlots || {};
            const gl2 = state2._gearset2LockedSlots || {};
            const glk1 = Object.keys(gl1).sort();
            const glk2 = Object.keys(gl2).sort();
            if (glk1.length !== glk2.length) return false;
            for (const key of glk1) { if (!gl2[key]) return false; }
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

            // Restore per-slot lock state
            const newLockedSlots = state._lockedSlots || {};
            const currentLockedSlots = window.store.state.gearsets?.lockedSlots || {};
            if (JSON.stringify(newLockedSlots) !== JSON.stringify(currentLockedSlots)) {
                window.store.state.gearsets.lockedSlots = { ...newLockedSlots };
                window.store._notifySubscribers('gearsets.lockedSlots');
                window.store._syncToBackend('ui.lockedSlots', window.store.state.gearsets.lockedSlots);
            }

            // Restore alternatives state
            window.store.state.gearsets.alternatives = state._alternatives || null;
            window.store.state.gearsets.lockedAlternatives = state._lockedAlternatives || null;
            // Notify AFTER restoring — the gearsets.current notify above fires
            // before this block, so subscribers that render from alternatives
            // (e.g. the column-2 Non-owned/Locked Upgrades section) would
            // otherwise re-render against the pre-restore (null) values and
            // never see the restored alternatives on undo/redo.
            window.store._notifySubscribers('gearsets.alternatives');
            window.store._notifySubscribers('gearsets.lockedAlternatives');

            // Restore gearset2 if it was captured
            if (state._gearset2 !== undefined && window.store.state.gearsets?.comparisonMode) {
                const allSlots = [
                    'head', 'cape', 'back', 'hands', 'chest', 'neck',
                    'primary', 'legs', 'secondary', 'ring1', 'ring2', 'feet',
                    'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5',
                    'consumable', 'pet'
                ];
                let gs2Changed = false;
                const gs2 = state._gearset2 || {};
                for (const slot of allSlots) {
                    const newItem = gs2[slot] || null;
                    const curItem = window.store.state.gearsets.gearset2?.[slot] || null;
                    if (JSON.stringify(newItem) !== JSON.stringify(curItem)) {
                        window.store.state.gearsets.gearset2[slot] = newItem;
                        gs2Changed = true;
                    }
                }
                if (gs2Changed) {
                    window.store._notifySubscribers('gearsets.gearset2');
                    window.store._saveGearset2();
                }

                // Restore gearset2 locks
                const newGs2Locks = state._gearset2LockedSlots || {};
                const curGs2Locks = window.store.state.gearsets?.gearset2LockedSlots || {};
                if (JSON.stringify(newGs2Locks) !== JSON.stringify(curGs2Locks)) {
                    window.store.state.gearsets.gearset2LockedSlots = { ...newGs2Locks };
                    window.store._notifySubscribers('gearsets.lockedSlots');
                    window.store._syncToBackend('ui.gearset2LockedSlots', newGs2Locks);
                }
            }

            // Restore activity/recipe selection
            const savedCol3 = state._column3 || {};
            const currentCol3 = window.store.state.column3 || {};
            const activityChanged = savedCol3.selectedActivity !== (currentCol3.selectedActivity || null);
            const recipeChanged = savedCol3.selectedRecipe !== (currentCol3.selectedRecipe || null);

            if (activityChanged || recipeChanged) {
                if (!window.store.state.column3) {
                    window.store.state.column3 = {};
                }
                window.store.state.column3.selectedActivity = savedCol3.selectedActivity;
                window.store.state.column3.selectedRecipe = savedCol3.selectedRecipe;
                window.store._notifySubscribers('column3.selectedActivity');
                window.store._notifySubscribers('column3.selectedRecipe');
                window.store._saveColumn3Selection();

                // Update the selector dropdowns to reflect the restored selection
                if (savedCol3.selectedActivity && window.activitySelector) {
                    window.activitySelector.render();
                } else if (savedCol3.selectedRecipe && window.recipeSelector) {
                    window.recipeSelector.render();
                } else {
                    // Both null — re-render both selectors
                    if (window.activitySelector) window.activitySelector.render();
                    if (window.recipeSelector) window.recipeSelector.render();
                }
            }

            // Restore crafting tree state
            if (state._craftingTreeNodes !== undefined) {
                const ctNodes = state._craftingTreeNodes || [];
                window.store.update('ui.crafting_tree.nodes', ctNodes);
                // If the crafting tree view is open, re-render it
                if (window._craftingTreeViewGlobal) {
                    window._craftingTreeViewGlobal.treeNodes = ctNodes;
                    window._craftingTreeViewGlobal._renderTree();
                }
            }

            console.log('Undo/Redo: Applied state', state);

            // Restore scroll position after state is applied
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        } finally {
            // Keep isApplyingState true long enough for the debounced pushState (300ms) to see it
            setTimeout(() => {
                this.isApplyingState = false;
            }, 500);
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
     * Jump directly to a specific history index in one step.
     * Used by the undo/redo history popup when the user clicks
     * an entry several steps away. No intermediate states are
     * replayed — we just apply the target state.
     *
     * @param {number} targetIndex - Index in this.history to jump to
     */
    jumpToIndex(targetIndex) {
        if (targetIndex < 0 || targetIndex >= this.history.length) {
            console.log('Undo/Redo: jumpToIndex out of range', targetIndex);
            return;
        }
        if (targetIndex === this.currentIndex) {
            return;
        }

        this.currentIndex = targetIndex;
        this.applyState(this.history[targetIndex]);
        this.updateButtons();

        console.log('Undo/Redo: Jumped to index', targetIndex);
    }

    /**
     * Build a list of entries that clicking undo would move to,
     * ordered oldest-first so the UI can scroll to the bottom
     * (most recent / closest to current) by default.
     *
     * Each row's label describes the action that WOULD BE UNDONE
     * by clicking it — i.e. the transition history[i] -> history[i+1].
     * That way, the bottom row always labels the most recent action
     * (matching the undo tooltip), and each row reads as "click to
     * undo THIS action."
     *
     * @returns {Array<{index: number, label: string}>}
     */
    getUndoList() {
        const list = [];
        if (!this.canUndo()) return list;

        // Indices [0 .. currentIndex-1] are undo targets.
        // Top = oldest (furthest), bottom = one step back (closest).
        for (let i = 0; i < this.currentIndex; i++) {
            // Label = the single change that this row would roll back.
            const label = this.describeChanges(this.history[i], this.history[i + 1]);
            list.push({ index: i, label });
        }
        return list;
    }

    /**
     * Build a list of entries that clicking redo would move to.
     * Ordered so the entry closest to current sits at the bottom
     * (same convention as the undo list: bottom = closest to now,
     * top = furthest away).
     *
     * Each row's label describes the action that WOULD BE REDONE
     * by clicking it — the transition history[i-1] -> history[i].
     *
     * @returns {Array<{index: number, label: string}>}
     */
    getRedoList() {
        const list = [];
        if (!this.canRedo()) return list;

        // Indices [currentIndex+1 .. end] are redo targets.
        // Furthest (largest index) at top, nearest (currentIndex+1) at bottom.
        for (let i = this.history.length - 1; i > this.currentIndex; i--) {
            const label = this.describeChanges(this.history[i - 1], this.history[i]);
            list.push({ index: i, label });
        }
        return list;
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

        // Notify any listeners (history popup, etc.) that state changed.
        for (const cb of this._changeObservers) {
            try { cb(); } catch (e) { console.warn('Undo/Redo observer error', e); }
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

        // Subscribe to per-slot lock changes
        window.store.subscribe('gearsets.lockedSlots', () => {
            if (!this.initialized) return;

            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 300);
        });

        // Subscribe to gearset2 changes (comparison mode)
        window.store.subscribe('gearsets.gearset2', () => {
            if (!this.initialized || this.isApplyingState) return;
            if (!window.store.state.gearsets?.comparisonMode) return;
            if (window.store._isRestoringGearset2) return; // session restore, not a user action

            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 300);
        });

        // Subscribe to activity/recipe selection changes
        window.store.subscribe('column3.selectedActivity', () => {
            if (!this.initialized || this.isApplyingState) return;

            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 300);
        });

        window.store.subscribe('column3.selectedRecipe', () => {
            if (!this.initialized || this.isApplyingState) return;

            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 300);
        });

        // Subscribe to crafting tree node changes
        window.store.subscribe('ui.crafting_tree.nodes', () => {
            if (!this.initialized || this.isApplyingState) return;

            if (this._pushTimeout) {
                clearTimeout(this._pushTimeout);
            }

            this._pushTimeout = setTimeout(() => {
                this.pushState();
            }, 500); // Slightly longer debounce for tree changes (they can be rapid)
        });
    }
}

// Create global instance
const undoRedoManager = new UndoRedoManager();

// Export for ES6 modules
export default undoRedoManager;

// Also make available globally
window.undoRedoManager = undoRedoManager;
