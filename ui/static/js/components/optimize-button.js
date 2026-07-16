/**
 * OptimizeButton Component
 * 
 * Button that appears when an activity or recipe is selected.
 * Runs optimization to find the best gearset and auto-saves it.
 * 
 * Features:
 * - Only visible when activity or recipe is selected
 * - Shows loading state during optimization
 * - Auto-saves optimized gearset with descriptive name
 * - Gear icon button to open optimization settings
 * - Target drop/quality selector
 * - Background optimization with polling
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import { wireInfoIcons } from '../info-popover.js';
import { runLocalCompute } from '../local-compute.js';
import { runTravelOptimizeLocal, isLocalComputeEnabled } from '../local-compute.js';
import { maybeShowLocalSpeedWarning } from '../local-speed-warning.js';
import { getInstantActionsPet, getAbilityStatsPet, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';
import { mountXyPriorityList, defaultRecipeEntries, ensureXyStyles } from './xy-recipe-priority-list.js';
import { mountXyActivityPriorityList, defaultActivityEntries } from './xy-activity-priority-list.js';
import { mountTravelPriorityList, defaultTravelEntries } from './travel-priority-list.js';

class OptimizeButton extends Component {
    /**
     * Create an optimize button
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // UI state
        this.isOptimizing = false;
        this.selectedActivity = null;
        this.selectedRecipe = null;
        this.targetDrop = store.state.ui?.column3?.targetDrop || 'cat:normal_items'; // Default for activities
        this.targetQuality = 'Perfect'; // Default for recipes
        this.targetDropRate = store.state.ui?.column3?.targetDropRate || 0; // Custom drop rate for fine_item/collectible targets
        this.budgetMaterials = 0; // Budget: input materials available
        this.budgetTarget = 0;    // Budget: output items desired
        this.dropTableData = null;
        this._hasPrimaryDrops = true;
        this.recipeData = null;
        this.isTargetDropdownOpen = false;
        this.showEquipButton = false;
        this.optimizedGearsetId = null;
        // Inline optimization settings panel — persisted across sessions via localStorage
        this.inlineSettingsOpen = localStorage.getItem('inlineSettingsOpen') === 'true';

        // Instant-actions mode state — persisted to session per skill type
        this.instantActionsForaging = false;
        this.instantActionsSmelting = false;
        // Pet catalog cache for eligibility checks — load eagerly
        this._petCatalog = null;
        api.getCatalog().then(catalogData => {
            this._petCatalog = (catalogData.items || []).filter(item => item.type === 'pet');
            // Re-render to show checkbox if an activity/recipe is already selected
            if (this.selectedActivity || this.selectedRecipe) {
                this.render();
                this.attachEvents();
            }
        }).catch(() => { });

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onSelectionChange());
        this.subscribe('column3.selectedRecipe', () => this.onSelectionChange());
        this.subscribe('gearsets.comparisonMode', () => {
            this.render();
            this.attachEvents();
        });

        // Keep the quick-settings "Run optimization locally" checkbox in sync
        // when the same global setting is toggled on another surface (settings
        // modal, goals report, crafting-tree settings).
        window.addEventListener('runLocalOptimizationChanged', () => {
            const enabled = !!(window.settingsModal && window.settingsModal.runLocalOptimization);
            const $cb = this.$element && this.$element.find && this.$element.find('.opt-run-local-checkbox');
            if ($cb && $cb.length) $cb.prop('checked', enabled);
        });

        // Listen for show item finding drops checkbox change
        window.addEventListener('showItemFindingDropsChanged', () => {
            console.log('Show item finding drops changed, reloading drop table');
            if (this.selectedActivity) {
                // If unchecking and current target is an equipment drop, reset to raw rewards
                const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';
                if (!showItemFinding && this.targetDrop !== 'raw_rewards' && this.dropTableData) {
                    const currentDrop = this.dropTableData.find(d =>
                        d.item_name === this.targetDrop || `${d.item_name} (Fine)` === this.targetDrop
                    );
                    if (currentDrop && currentDrop.source === 'equipment') {
                        this.targetDrop = 'raw_rewards';
                    }
                }

                this.loadDropTable().then(() => {
                    this.render();
                    this.attachEvents();
                });
            }
        });

        // Re-render when optimization settings are loaded (per-entry targets may change dropdown count)
        window.addEventListener('optimizationSettingsLoaded', () => {
            // Don't re-render if we're animating a duplicate/remove (we handle our own render)
            if (this._skipSettingsRerender) return;

            if (this.inlineSettingsOpen) {
                // Inline panel is open — always re-render the panel when settings load,
                // even if shouldShow() is currently false. This handles the race where
                // settings finish loading before onSelectionChange() has set selectedRecipe,
                // causing the panel to render with an empty sorting list on page load.
                // If the component isn't visible yet, _renderInlineSettings() is a no-op.
                const scrollTop = this.$element.find('.inline-sort-list').scrollTop();
                this._renderInlineSettings();
                this.$element.find('.inline-sort-list').scrollTop(scrollTop);
            } else if (this.shouldShow()) {
                this.render();
            }
        });

        // Initialize from current store state (session may already be loaded)
        this.onSelectionChange();
    }

    /**
     * Handle selection change
     */
    async onSelectionChange() {
        const prevActivity = this.selectedActivity;
        const prevRecipe = this.selectedRecipe;

        this.selectedActivity = store.state.column3?.selectedActivity;
        this.selectedRecipe = store.state.column3?.selectedRecipe;

        // Load drop table if activity selected and changed
        if (this.selectedActivity && this.selectedActivity !== prevActivity) {
            console.log('Activity changed, loading drop table for:', this.selectedActivity);

            // Save current target drop before loading new drop table
            const previousTargetDrop = this.targetDrop;

            await this.loadDropTable();
            console.log('Drop table loaded:', this.dropTableData);

            // Check if previous target exists in new drop table
            if (previousTargetDrop && previousTargetDrop !== 'raw_rewards' && this.dropTableData) {
                const targetExists = this.dropTableData.some(drop =>
                    drop.item_name === previousTargetDrop ||
                    `${drop.item_name} (Fine)` === previousTargetDrop
                );

                if (targetExists) {
                    // Keep the same target
                    console.log('Previous target exists in new activity, keeping:', previousTargetDrop);
                    this.targetDrop = previousTargetDrop;
                } else {
                    // Reset to raw rewards
                    console.log('Previous target not found in new activity, resetting to raw rewards');
                    this.targetDrop = 'raw_rewards';
                }
            } else if (!prevActivity) {
                // First time selecting an activity
                this.targetDrop = 'raw_rewards';
            }

            // Validate per-entry targets in sorting data against new drop table
            this._validateSortingTargets();
        }

        // Load recipe data if recipe selected and changed
        if (this.selectedRecipe && (this.selectedRecipe !== prevRecipe || (this.selectedRecipe && this.selectedRecipe.startsWith('generic::')))) {
            console.log('Recipe changed, loading recipe data for:', this.selectedRecipe);
            await this.loadRecipeData();
            console.log('Recipe data loaded:', this.recipeData);

            // Reset quality when switching recipes (or first time)
            if (!prevRecipe) {
                this.targetQuality = 'Perfect';
            }

            // Hide equip button when recipe changes
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
        }

        // Hide equip button when activity changes
        if (this.selectedActivity && this.selectedActivity !== prevActivity) {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
        }

        // Load instant-actions state from session config
        const sessionConfig = store.state.ui || {};
        this.instantActionsForaging = !!sessionConfig.instant_actions_foraging;
        this.instantActionsSmelting = !!sessionConfig.instant_actions_smelting;

        this.render();
    }

    /**
     * Load drop table for selected activity
     */
    async loadDropTable() {
        try {
            // Handle generic activities — they're not in /api/activities
            if (this.selectedActivity && this.selectedActivity.startsWith('generic')) {
                if (this.selectedActivity.includes('::')) {
                    const defId = this.selectedActivity.replace('generic::', '');
                    try {
                        const activity = await $.get(`/api/generic-definition-view/${defId}`);
                        if (activity) {
                            this.dropTableData = [
                                ...(activity.drop_table || []),
                                ...(activity.secondary_drop_table || [])
                            ];
                            this._hasPrimaryDrops = (activity.drop_table || []).some(d => d.item_name !== 'Nothing');
                        }
                    } catch (e) {
                        this.dropTableData = [];
                        this._hasPrimaryDrops = false;
                    }
                } else {
                    this.dropTableData = [];
                    this._hasPrimaryDrops = false;
                }
                return;
            }

            const response = await $.get('/api/activities');
            if (window.__walkscapeVerboseDebug) {
                console.log('[VERBOSE] Activities API response (optimize-button):', response);
            } else {
                console.log('[OPT] Activities API response: count=',
                    Array.isArray(response?.activities) ? response.activities.length : 0);
            }

            const activity = response.activities.find(a => a.id === this.selectedActivity);
            if (activity) {
                // Combine primary and secondary drop tables
                this.dropTableData = [
                    ...(activity.drop_table || []),
                    ...(activity.secondary_drop_table || [])
                ];
                // Track whether the activity has real primary drops (not just "Nothing")
                this._hasPrimaryDrops = (activity.drop_table || []).some(d => d.item_name !== 'Nothing');
                console.log('Found activity, combined drop tables:', this.dropTableData.length, 'drops, hasPrimaryDrops:', this._hasPrimaryDrops);

                // If "Show item finding drops" is checked, collect ALL ItemFindingCategory stats from ALL owned items
                const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';
                console.log('Show item finding drops:', showItemFinding);
                if (showItemFinding) {
                    await this.addAllItemFindingDrops(activity);
                }
            } else {
                console.error('Activity not found in response:', this.selectedActivity);
                console.log('Available activities:', response.activities.map(a => a.id));
            }
        } catch (error) {
            console.error('Failed to load drop table:', error);
        }
    }

    /**
     * Add ALL item finding drops from ALL owned items for this activity
     * @param {Object} activity - Activity object with primary_skill
     */
    async addAllItemFindingDrops(activity) {
        try {
            console.log('=== addAllItemFindingDrops START ===');
            const skill = activity.primary_skill?.toLowerCase() || 'global';
            console.log('Calling /api/all-item-finding-drops for skill:', skill);

            const response = await fetch('/api/all-item-finding-drops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skill })
            });

            if (!response.ok) {
                console.error('Backend returned error:', response.status);
                return;
            }

            const data = await response.json();
            const equipmentDrops = data.drops || [];

            console.log('Backend returned', equipmentDrops.length, 'expanded drops');

            for (const drop of equipmentDrops) {
                this.dropTableData.push({
                    item_name: drop.item_name,
                    item_ref: drop.item_ref,
                    chance_percent: drop.chance_percent,
                    quantity: { min: drop.min_qty, max: drop.max_qty },
                    has_fine_material: drop.has_fine_material,
                    source: 'equipment'
                });
            }

            console.log('Total drops after adding equipment:', this.dropTableData.length);
            console.log('=== addAllItemFindingDrops END ===');
        } catch (error) {
            console.error('Failed to add item finding drops:', error);
        }
    }

    /**
     * Load recipe data for selected recipe
     */
    async loadRecipeData() {
        try {
            // Handle generic recipes
            if (this.selectedRecipe && this.selectedRecipe.startsWith('generic::')) {
                const defId = this.selectedRecipe.replace('generic::', '');
                const data = await api.getGenericDefinitionView(defId);
                if (data && data.type === 'recipe') {
                    this.recipeData = data;
                    return;
                }
            }

            const response = await $.get('/api/recipes');
            const recipe = response.recipes.find(r => r.id === this.selectedRecipe);
            if (recipe) {
                this.recipeData = recipe;
                console.log('Found recipe, has_fine_option:', recipe.has_fine_option);
            } else {
                console.error('Recipe not found:', this.selectedRecipe);
            }
        } catch (error) {
            console.error('Failed to load recipe data:', error);
        }
    }

    /**
     * Check if current recipe produces quality items
     */
    isQualityRecipe() {
        // If recipe data not loaded yet, assume it's NOT a quality recipe (safer default)
        if (!this.recipeData) {
            console.log('isQualityRecipe: No recipe data loaded, assuming non-quality');
            return false;
        }

        // Generic recipes use the is_quality_item flag
        if (this.recipeData.is_quality_item) {
            return true;
        }

        // Wiki recipes: only exclude Material/Consumable outputs (they don't have quality).
        // Null/empty output_item is treated as a quality recipe (scraper may not have linked it).
        const outputItem = this.recipeData.output_item || '';
        const isNonQuality = outputItem.startsWith('Material.') || outputItem.startsWith('Consumable.');

        // For generic recipes without is_quality_item, treat as non-quality
        if (this.recipeData.id && String(this.recipeData.id).startsWith('generic::')) {
            return false;
        }

        return !isNonQuality;
    }

    /**
     * Check if button should be visible
     */
    shouldShow() {
        return !!(this.selectedActivity || this.selectedRecipe);
    }

    /**
     * Check if the current selection is the traveling pseudo-activity
     */
    isTravelActivity() {
        return this.selectedActivity === 'traveling';
    }

    /**
     * Cancel the currently running optimization.
     *
     * Calls the backend which SIGTERMs the worker subprocess and marks the
     * session as cancelled so the SSE/poll completion path won't show a
     * "failed" toast. Also cancels travel optimization tasks when active.
     */
    async cancelOptimization() {
        if (!this.isOptimizing) return;

        // Clear any pending revert timer from the two-click confirm UX
        if (this._cancelRevertTimer) {
            clearTimeout(this._cancelRevertTimer);
            this._cancelRevertTimer = null;
        }

        // Mark locally so the SSE/poll callbacks suppress the "failed" toast.
        this._wasCancelled = true;

        try {
            const resp = await $.ajax({
                url: '/api/optimization-cancel',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({})
            });

            if (resp?.cancelled) {
                api.showInfo('Optimization cancelled.');
            } else {
                // No active optimization on server — might already be finishing.
                // Still reset local state so the UI unsticks.
                console.log('Cancel: no active optimization on server', resp);
            }
        } catch (err) {
            console.error('Cancel optimization failed:', err);
            api.showError('Failed to cancel optimization.');
        }

        // Reset local state so the UI returns to the idle view.
        this.isOptimizing = false;
        this._optimizingSlot = null;
        this._suppressResultUI = false;
        this._findAlternativesOnly = false;

        // Close SSE stream if open
        if (this._sseSource) {
            try { this._sseSource.close(); } catch (e) { /* ignore */ }
            this._sseSource = null;
        }

        this.render();
    }

    /**
     * Check whether the current optimization was cancelled.
     *
     * Returns true if we cancelled locally OR if the server's cancelled flag
     * is set (e.g. cancel came from another tab). The server flag is
     * consumed on read.
     */
    async _checkCancelledFlag() {
        if (this._wasCancelled) return true;
        try {
            const resp = await $.get('/api/optimization-cancel/check');
            if (resp?.cancelled) {
                this._wasCancelled = true;
                return true;
            }
        } catch (e) {
            // If the check endpoint fails, fall back to the local flag
            console.warn('Cancelled-flag check failed:', e);
        }
        return false;
    }

    /**
     * Run travel optimization for the current start/end route.
     *
     * @param {Object} [options] - Optional settings for one-shot popup flows.
     * @param {Object|null} [options.overrideLocks] - Per-request slot locks
     *   ({slot: {itemId, quality, level}}). Used by the "Optimize Slot & Equip"
     *   popup to lock every slot except the one being optimized.
     * @param {boolean} [options.showNonOwned] - Compute and return non-owned
     *   upgrade alternatives alongside the optimized gearset.
     * @param {boolean} [options.suppressResultUI] - Suppress the success toast
     *   and equip button — the caller (e.g. popup) handles equipping itself.
     */
    async optimizeTravel(options = {}) {
        if (this.isOptimizing) return;

        // One-time nudge if this device benchmarked faster than the server.
        // Blocks (awaits) until the user picks local vs server, applying the
        // choice before the optimize proceeds. No-op once chosen / if ineligible.
        try { await maybeShowLocalSpeedWarning(); } catch (_) { /* non-fatal */ }

        // Get start/end from the TravelInfoSection
        const travelSection = window.activityInfoSection?.travelInfoSection;
        if (!travelSection) {
            api.showError('Travel section not found. Please select Traveling first.');
            return;
        }

        const { start, end } = travelSection.getLocations();
        // [TRAVEL-DIAG] Capture what the optimizer is being asked to optimize.
        // Bug d7c77316 / Primary-reset: if start/end here don't match the
        // dropdowns the user set, that's the dropdown→state-sync bug. If
        // start/end ARE correct here but the result equips the wrong rings,
        // the bug is downstream (route resolution / optimizer / equip).
        try {
            console.log('[TRAVEL-DIAG][optimizeTravel] start =', start, 'end =', end);
            console.log('[TRAVEL-DIAG][optimizeTravel] travelSection.startLocation =', travelSection.startLocation,
                        'travelSection.endLocation =', travelSection.endLocation);
            console.log('[TRAVEL-DIAG][optimizeTravel] store.column3.travelStart =', store.state.column3?.travelStart,
                        'travelEnd =', store.state.column3?.travelEnd);
            const routeData = travelSection.getRouteData?.();
            if (routeData?.segments) {
                console.log('[TRAVEL-DIAG][optimizeTravel] currently displayed route segments:',
                    routeData.segments.map(s => `${s.start || s.start_name}→${s.end || s.end_name}`).join(' | '));
            } else {
                console.log('[TRAVEL-DIAG][optimizeTravel] no routeData on travelSection — fetchRoute may not have completed');
            }
        } catch (e) {
            console.warn('[TRAVEL-DIAG][optimizeTravel] diag log failed:', e);
        }
        if (!start || !end) {
            api.showError('No Start/End location selected.');
            return;
        }

        this.isOptimizing = true;
        this.showEquipButton = false;
        this.optimizedGearsetId = null;
        this._suppressResultUI = !!options.suppressResultUI;
        this._findAlternativesOnly = !!options.findOnly;
        this._wasCancelled = false;
        this.render();

        try {
            await store.flushPendingSaves();
        } catch (e) {
            console.warn('[TravelOptimize] Failed to flush pending saves:', e);
        }

        try {
            const payload = { start, end };
            // Build locked_slots from per-slot locks + global lock toggle.
            // Bug 0ca4acab: previously only options.overrideLocks was passed,
            // so per-slot locks (e.g. user locked Primary to Farganite sword
            // Eternal) were silently ignored by the travel optimizer.
            const lockedSlots = options.overrideLocks
                ? { ...options.overrideLocks }
                : this._buildTravelLockedSlots();
            if (lockedSlots && Object.keys(lockedSlots).length > 0) {
                payload.locked_slots = lockedSlots;
            }
            if (options.showNonOwned) {
                payload.show_non_owned_alternatives = true;
            }

            // Always send the equipped pet + consumable as fixed (non-optimizable)
            // travel items so the optimizer scores with their WE/DA — matching the
            // Travel info display. Pet level resolved the same way Combined Stats /
            // encodeCurrentGearset do (user_overrides -> store.items -> slot) to
            // keep optimizer scoring and the displayed stats consistent.
            const fixedSlots = this._buildTravelFixedSlots();
            if (fixedSlots) {
                payload.fixed_slots = fixedSlots;
            }

            // Global "Include pets/consumables in optimization" toggles. When on,
            // the travel optimizer tries the player's owned pets/consumables and
            // equips the best one for the route (instead of pinning the equipped
            // one). Same toggles the activity/recipe optimizers read.
            payload.include_pets = !!(window.settingsModal && window.settingsModal.includePets);
            payload.include_consumables = !!(window.settingsModal && window.settingsModal.includeConsumables);

            // Local (Pyodide) travel optimization: when the FAC + user toggle are
            // on, ask the server to return the worker request_data instead of
            // spawning the subprocess, run it in the browser, and POST the result
            // back for identical DB persistence.
            payload.run_local = isLocalComputeEnabled();

            // [TRAVEL-DIAG] Final payload going to /api/travel/optimize.
            // If lockedSlots is missing/empty when the user has Primary
            // locked, that's the lock-not-sent bug. Compare to the same
            // log in _buildTravelLockedSlots() and the perSlotLocks store.
            console.log('[TRAVEL-DIAG][optimizeTravel] sending payload to /api/travel/optimize:',
                JSON.parse(JSON.stringify(payload)));
            console.log('[TRAVEL-DIAG][optimizeTravel] payload.locked_slots keys:',
                payload.locked_slots ? Object.keys(payload.locked_slots) : '(none)');

            const response = await $.ajax({
                url: '/api/travel/optimize',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(payload)
            });

            if (response.success) {
                // Local path: server returned request_data instead of starting a
                // server job. Run the travel optimizer in Pyodide, POST the result
                // for DB persistence, then reuse the standard completion handler.
                if (response.run_local && response.request_data) {
                    if (!this._suppressResultUI) {
                        api.showSuccess('Optimizing travel locally in your browser...');
                    }
                    try {
                        const localResult = await runTravelOptimizeLocal({
                            task_key: response.task_key,
                            request_data: response.request_data,
                        });
                        if (localResult && localResult.success === false) {
                            api.showError('Local travel optimization failed: ' +
                                (localResult.error || 'unknown error — see console'));
                            this.isOptimizing = false;
                            this._suppressResultUI = false;
                            this._findAlternativesOnly = false;
                            this.render();
                            return;
                        }
                        await this._handleTravelOptimizationComplete(response.task_key);
                    } catch (localErr) {
                        console.error('[local-travel] failed:', localErr);
                        api.showError('Local travel optimization failed: ' +
                            (localErr && localErr.message ? localErr.message : localErr));
                        this.isOptimizing = false;
                        this._suppressResultUI = false;
                        this._findAlternativesOnly = false;
                        this.render();
                    }
                    return;
                }
                if (!this._suppressResultUI) {
                    api.showSuccess('Travel optimization started! Finding best gear set...');
                }
                this._pollTravelOptimization(response.task_key);
            } else {
                api.showError('Travel optimization failed to start.');
                this.isOptimizing = false;
                this._suppressResultUI = false;
                this._findAlternativesOnly = false;
                this.render();
            }
        } catch (error) {
            console.error('Travel optimization error:', error);
            const msg = error.responseJSON?.detail?.message
                || error.responseJSON?.detail
                || 'Travel optimization failed. Please try again.';
            api.showError(typeof msg === 'string' ? msg : JSON.stringify(msg));
            this.isOptimizing = false;
            this._suppressResultUI = false;
            this._findAlternativesOnly = false;
            this.render();
        }
    }

    /**
     * Build the locked_slots payload for a travel optimization request from
     * the user's per-slot locks (gearset 1 only — travel optimizer always
     * runs on the active gearset) plus the global "Lock current gear" toggle.
     *
     * Mirrors the logic in optimize-button.js startOptimize() for the
     * non-travel path (see ~lines 2560-2615 for the recipe/activity flow).
     * Bug 0ca4acab: travel optimizer previously ignored these locks entirely.
     *
     * @returns {Object} { slotName: { itemId, quality, level? }, ... }
     */
    /**
     * Build the fixed (non-optimizable) pet + consumable payload from the current
     * gearset. These always apply during travel and are not slots the optimizer
     * fills, so they're sent separately from locked_slots. Pet level is resolved
     * the same way Combined Stats / encodeCurrentGearset do so optimizer scoring
     * matches the Travel info display.
     *
     * @returns {Object|null} { pet?: {species, level}, consumable?: {id, is_fine} }
     */
    _buildTravelFixedSlots() {
        const gear = store.state.gearsets?.current || {};
        const fixed = {};

        const pet = gear['pet'];
        if (pet && (pet.species || pet.itemId || pet.id)) {
            const species = String(pet.species || pet.itemId || pet.id || '');
            const petId = pet.itemId || pet.id || species.toLowerCase();
            const ov = (store.state.ui?.user_overrides?.items?.[petId]) || {};
            const base = (store.state.items?.[petId]) || {};
            const level = ov.level != null ? ov.level
                : (base.level != null ? base.level
                : (pet.level != null ? pet.level : 0));
            if (species && level > 0) {
                fixed.pet = { species: species, level: level };
            }
        }

        const cons = gear['consumable'];
        if (cons && (cons.itemId || cons.id || cons.name)) {
            let consId = String(cons.itemId || cons.id || cons.name || '');
            let consFine = !!cons.is_fine || consId.toLowerCase().endsWith('_fine');
            consId = consId.replace(/_fine$/i, '');
            if (consId) {
                fixed.consumable = { id: consId, is_fine: consFine };
            }
        }

        return (fixed.pet || fixed.consumable) ? fixed : null;
    }

    _buildTravelLockedSlots() {
        const lockedSlots = {};
        const currentGear = store.state.gearsets?.current || {};
        const perSlotLocks = store.state.gearsets?.lockedSlots || {};

        // [TRAVEL-DIAG] Capture raw lock state. If perSlotLocks is empty/null
        // when user clicked the lock icon, the bug is in the lock-icon UI.
        try {
            console.log('[TRAVEL-DIAG][_buildTravelLockedSlots] perSlotLocks keys =',
                Object.keys(perSlotLocks),
                'sample primary =', perSlotLocks.primary,
                'globalToggle =', !!window.settingsModal?.lockCurrentGearSlots);
            console.log('[TRAVEL-DIAG][_buildTravelLockedSlots] currentGear primary =',
                currentGear.primary?.name || currentGear.primary?.itemId || '(empty)');
        } catch (e) {
            console.warn('[TRAVEL-DIAG][_buildTravelLockedSlots] diag log failed:', e);
        }

        // Per-slot locks (lock icon clicked individually per slot).
        for (const slotName of Object.keys(perSlotLocks)) {
            const lockValue = perSlotLocks[slotName];
            if (lockValue && typeof lockValue === 'object' && lockValue.itemId) {
                // New format: snapshotted lock data
                const lockData = {
                    itemId: lockValue.itemId,
                    quality: lockValue.quality || null,
                };
                if (lockValue.level !== undefined) lockData.level = lockValue.level;
                lockedSlots[slotName] = lockData;
            } else if (lockValue) {
                // Legacy boolean format — look up the item from currentGear
                const item = currentGear[slotName];
                if (item && item.itemId) {
                    const lockData = {
                        itemId: item.itemId,
                        quality: item.quality || null,
                    };
                    if (item.level !== undefined) lockData.level = item.level;
                    lockedSlots[slotName] = lockData;
                }
            }
        }

        // Global "Lock current gear" toggle: lock every equipped slot not already locked.
        if (window.settingsModal?.lockCurrentGearSlots) {
            for (const [slot, item] of Object.entries(currentGear)) {
                if (!item || !item.itemId) continue;
                if (lockedSlots[slot]) continue;
                const lockData = {
                    itemId: item.itemId,
                    quality: item.quality || null,
                };
                if (item.level !== undefined) lockData.level = item.level;
                lockedSlots[slot] = lockData;
            }
        }

        // [TRAVEL-DIAG] Final result.
        console.log('[TRAVEL-DIAG][_buildTravelLockedSlots] returning lockedSlots:',
            JSON.parse(JSON.stringify(lockedSlots)));

        return lockedSlots;
    }

    /**
     * Poll for travel optimization result via the travel status endpoint.
     * When complete, the backend has already saved the gearset — reload and equip.
     * @param {string} taskKey - Task key from /api/travel/optimize
     */
    async _pollTravelOptimization(taskKey) {
        let elapsedMs = 0;
        const maxElapsedMs = 120000; // 2 minutes
        let stopped = false;
        let pollTimer = null;

        const stop = () => {
            stopped = true;
            if (pollTimer) clearTimeout(pollTimer);
        };

        const getNextDelay = () => {
            if (elapsedMs < 2000) return 500;
            if (elapsedMs < 10000) return 1000;
            return 3000;
        };

        const poll = async () => {
            if (stopped) return;

            try {
                const response = await $.get(`/api/travel-config/optimize-status?keys=${encodeURIComponent(taskKey)}`);
                const task = response.tasks?.[taskKey];

                if (task && task.status === 'complete') {
                    stop();
                    await this._handleTravelOptimizationComplete(taskKey);
                    return;
                } else if (task && task.status === 'error') {
                    stop();
                    api.showError(`Travel optimization failed: ${task.error || 'Unknown error'}`);
                    this.isOptimizing = false;
                    this.render();
                    return;
                }
                // status === 'running' or 'not_found': keep polling
            } catch (e) {
                console.error('Travel optimization poll error:', e);
            }

            const delay = getNextDelay();
            elapsedMs += delay;
            if (elapsedMs >= maxElapsedMs) {
                stop();
                api.showError('Travel optimization timed out. Please try again.');
                this.isOptimizing = false;
                this.render();
                return;
            }

            pollTimer = setTimeout(poll, delay);
        };

        pollTimer = setTimeout(poll, getNextDelay());
    }

    /**
     * Handle completed travel optimization — reload gearsets and equip/show button.
     * The backend has already saved the gearset to the main gearsets table.
     * @param {string} taskKey - e.g. "simple:kallaheim:centaham"
     */
    async _handleTravelOptimizationComplete(taskKey) {
        const autoEquip = window.settingsModal?.autoEquipOptimized;

        try {
            // Reload gearsets to pick up the newly saved travel gearset
            const freshGearSets = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
            console.log('[TravelOpt] freshGearSets count:', freshGearSets.length);
            console.log('[TravelOpt] taskKey:', taskKey);
            store.state.gearsets.saved = {};
            freshGearSets.forEach(gs => {
                store.state.gearsets.saved[gs.id] = {
                    name: gs.name,
                    slots: gs.slots_json,
                    export_string: gs.export_string,
                    is_optimized: gs.is_optimized,
                    created_at: gs.created_at,
                };
            });
            store._notifySubscribers('gearsets.saved');

            // Find the travel gearset we just created by matching its name.
            // The backend names it "Travel: {Start} → {End}" derived from the task key.
            // We can't rely on recency because a previously-run activity optimization
            // (e.g. Basket Weaving) may have a newer created_at timestamp.
            let newGs = null;
            const parts = taskKey.split(':');
            console.log('[TravelOpt] taskKey parts:', parts);
            // Task key shape is "simple:{start}:{end}" or "simple:{start}:{end}:{hash}"
            // when the popup flow adds a payload hash for uniqueness.
            if (parts.length >= 3 && parts[0] === 'simple') {
                const toTitle = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const expectedName = `Travel: ${toTitle(parts[1])} \u2192 ${toTitle(parts[2])}`;
                console.log('[TravelOpt] expectedName:', JSON.stringify(expectedName));
                console.log('[TravelOpt] all gearset names:', freshGearSets.map(gs => JSON.stringify(gs.name)));
                // Find by name among all gearsets (not just optimized), most recent first
                const byName = freshGearSets
                    .filter(gs => gs.name === expectedName)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                console.log('[TravelOpt] byName matches:', byName.length, byName.map(gs => gs.name));
                newGs = byName[0] || null;
                if (newGs) {
                    // Helps verify the fix is healthy in the wild — when this
                    // logs we know the named lookup hit on first try and the
                    // re-fetch retry/error path was never needed.
                    console.log('[TravelOpt] \u2713 FOUND on first try via name lookup:', {
                        id: newGs.id,
                        name: newGs.name,
                        is_optimized: newGs.is_optimized,
                        created_at: newGs.created_at,
                        slot_keys: Object.keys(newGs.slots_json || {}).filter(k => !k.startsWith('_')),
                    });
                }
            }
            // Fallback: re-fetch once after a short delay in case the save
            // committed after our initial gearset list query (race condition).
            // We DO NOT fall back to "most recent optimized gearset" by recency
            // — that produced bug reports where an unrelated stale gearset
            // (e.g. a previous "Travel: A → B" run) got equipped, silently
            // dropping locked slots and showing the wrong route in the toast.
            if (!newGs) {
                console.log('[TravelOpt] Name lookup failed on first try; re-fetching gearsets after 750ms in case save was racy');
                await new Promise(r => setTimeout(r, 750));
                try {
                    const refetched = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                    console.log('[TravelOpt] re-fetched gearsets count:', refetched.length);
                    if (parts.length >= 3 && parts[0] === 'simple') {
                        const toTitle = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        const expectedName = `Travel: ${toTitle(parts[1])} \u2192 ${toTitle(parts[2])}`;
                        const byName2 = refetched
                            .filter(gs => gs.name === expectedName)
                            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                        console.log('[TravelOpt] re-fetch byName matches:', byName2.length);
                        newGs = byName2[0] || null;
                        if (newGs) {
                            // Re-fetch hits indicate a real race between save
                            // commit and gearset list query. If this fires
                            // repeatedly in production logs we may want to
                            // increase the 750ms delay or have the backend
                            // commit synchronously before completing the task.
                            console.log('[TravelOpt] \u2713 FOUND on re-fetch (race condition recovered):', {
                                id: newGs.id,
                                name: newGs.name,
                                is_optimized: newGs.is_optimized,
                                created_at: newGs.created_at,
                                slot_keys: Object.keys(newGs.slots_json || {}).filter(k => !k.startsWith('_')),
                            });
                            // Refresh store cache too so the UI is in sync.
                            store.state.gearsets.saved = {};
                            refetched.forEach(gs => {
                                store.state.gearsets.saved[gs.id] = {
                                    name: gs.name,
                                    slots: gs.slots_json,
                                    export_string: gs.export_string,
                                    is_optimized: gs.is_optimized,
                                    created_at: gs.created_at,
                                };
                            });
                            store._notifySubscribers('gearsets.saved');
                        } else {
                            // Loud signal that something is genuinely wrong —
                            // either backend save failed or named differently.
                            // Compare expectedName against all names in the
                            // re-fetched list to make the mismatch obvious.
                            console.warn('[TravelOpt] \u2717 Re-fetch did NOT find expected gearset', {
                                expectedName,
                                refetched_names: refetched.map(gs => gs.name).slice(0, 20),
                                refetched_count: refetched.length,
                            });
                        }
                    }
                } catch (refetchErr) {
                    console.error('[TravelOpt] re-fetch failed:', refetchErr);
                }
            }
            console.log('[TravelOpt] selected newGs:', newGs ? { id: newGs.id, name: newGs.name, has_export: !!newGs.export_string, slots_json_keys: Object.keys(newGs.slots_json || {}) } : null);

            // [TRAVEL-DIAG] Log primary/ring contents of the selected gearset
            // BEFORE equipping. If primary is null/missing here while the user
            // had it locked, the optimizer dropped the locked item — backend
            // bug. If primary is correct here but ends up null after equip,
            // it's a frontend store-merge bug.
            try {
                const slots = (newGs && (newGs.slots_json || newGs.slots)) || {};
                const slotsBefore = store.state.gearsets?.current || {};
                console.log('[TRAVEL-DIAG][equip] BEFORE loadGearSet — current.primary =',
                    slotsBefore.primary?.name || slotsBefore.primary?.itemId || '(empty)',
                    'current.ring1 =', slotsBefore.ring1?.name || slotsBefore.ring1?.itemId || '(empty)',
                    'current.ring2 =', slotsBefore.ring2?.name || slotsBefore.ring2?.itemId || '(empty)');
                console.log('[TRAVEL-DIAG][equip] OPTIMIZER returned — primary =',
                    slots.primary?.name || slots.primary?.itemId || '(empty)',
                    'ring1 =', slots.ring1?.name || slots.ring1?.itemId || '(empty)',
                    'ring2 =', slots.ring2?.name || slots.ring2?.itemId || '(empty)');
            } catch (e) {
                console.warn('[TRAVEL-DIAG][equip] diag log failed:', e);
            }

            if (!newGs) {
                api.showError('Travel optimization complete but no gearset was found.');
                this.isOptimizing = false;
                this.render();
                return;
            }

            if (this._findAlternativesOnly) {
                // Discovery only ("Find alternatives") — the popup extracts the
                // computed alternatives off the result gearset and never equips,
                // so the user's current gear is left untouched.
            } else if (autoEquip || this._suppressResultUI) {
                // When suppressed (popup flow) we always equip the result so the
                // popup can re-render with the new gear + alternatives.
                await store.loadGearSet(newGs.id);
                // [TRAVEL-DIAG] After equip — what does store.state.gearsets.current
                // actually have now? If primary is now null/different from what the
                // optimizer returned, the equip step is the bug.
                try {
                    const after = store.state.gearsets?.current || {};
                    console.log('[TRAVEL-DIAG][equip] AFTER loadGearSet — current.primary =',
                        after.primary?.name || after.primary?.itemId || '(empty)',
                        'current.ring1 =', after.ring1?.name || after.ring1?.itemId || '(empty)',
                        'current.ring2 =', after.ring2?.name || after.ring2?.itemId || '(empty)');
                    const lockedAfter = store.state.gearsets?.lockedSlots || {};
                    console.log('[TRAVEL-DIAG][equip] AFTER loadGearSet — lockedSlots keys =',
                        Object.keys(lockedAfter), 'primary lock value =', lockedAfter.primary);
                } catch (e) {
                    console.warn('[TRAVEL-DIAG][equip] post-load diag log failed:', e);
                }
                if (!this._suppressResultUI) {
                    api.showSuccess(`Travel optimization complete! Equipped: ${newGs.name}`, { duration: 5000 });
                }
            } else {
                this.optimizedGearsetId = newGs.id;
                this.showEquipButton = true;
                const toastHtml = `Travel optimization complete! Saved: ${newGs.name}<br><span style="opacity:0.8;font-size:0.9em;">Click to equip optimized gear set</span>`;
                api.showSuccess(null, { html: toastHtml, duration: 10000, onClick: () => this.equipOptimizedGearset() });
            }

            // Check for owned-but-locked items that are locked due to custom stats
            // (same warning as activity optimization — e.g. Oak Skis locked because
            // user hasn't toggled "Skate Skiing x25" in Custom Stats)
            const gearsetForCheck = {
                slots_json: newGs.slots_json || newGs.slots,
            };
            console.log('[travel-opt] newGs.slots_json keys:', Object.keys(newGs.slots_json || newGs.slots || {}));
            console.log('[travel-opt] _locked_alternatives:', (newGs.slots_json || newGs.slots || {})._locked_alternatives);
            if (!this._suppressResultUI) {
                this._checkCustomStatsLockedAlternatives(gearsetForCheck);
            }

            // Notify listeners (e.g. item-selection-popup) that optimization is
            // complete so they can re-render with the fresh alternatives.
            window.dispatchEvent(new CustomEvent('optimization-complete', {
                detail: { gearset: newGs }
            }));
        } catch (e) {
            console.error('Failed to handle travel optimization result:', e);
            api.showError('Travel optimization complete but failed to load gearset.');
        }

        this.isOptimizing = false;
        this._suppressResultUI = false;
        this._findAlternativesOnly = false;
        this.render();
    }

    /**
     * Toggle inline optimization settings panel
     */
    openOptimizationSettings() {
        this.inlineSettingsOpen = !this.inlineSettingsOpen;
        // Persist so the inline panel auto-opens on next page load
        localStorage.setItem('inlineSettingsOpen', this.inlineSettingsOpen ? 'true' : 'false');

        // Animate the gear icon
        const $icon = this.$element.find('.optimize-settings-icon');
        if (this.inlineSettingsOpen) {
            $icon.addClass('settings-open');
        } else {
            $icon.removeClass('settings-open');
        }

        if (this.inlineSettingsOpen) {
            // Slide up quick settings header/content AND slide down inline panel simultaneously
            const $quickHeader = this.$element.find('.quick-opt-settings-header');
            const $quickContent = this.$element.find('.quick-opt-settings-content');
            const $targetSelector = this.$element.find('.target-selector');
            const $budgetSection = this.$element.find('.budget-section');

            if ($quickHeader.length && $quickHeader.is(':visible')) {
                $quickHeader.slideUp(250);
            }
            if ($quickContent.length && $quickContent.is(':visible')) {
                $quickContent.slideUp(250);
            }
            if ($targetSelector.length && $targetSelector.is(':visible')) {
                $targetSelector.slideUp(250);
            }
            if ($budgetSection.length && $budgetSection.is(':visible')) {
                $budgetSection.slideUp(250);
            }

            // Render the inline settings. _renderInlineSettings now
            // calls _ensureInlineOptWrapper() internally so the
            // .inline-opt-wrapper + "Open Global" button already exist
            // when we get here — we just need to slide it into view.
            // Previous code was creating a second wrapper on top of
            // the one built by _renderInlineSettings, which produced
            // two "Open Global Optimization Settings" buttons.
            this._renderInlineSettings();
            const $wrapper = this.$element.find('.inline-opt-wrapper').first();
            if ($wrapper.length) {
                $wrapper.hide();
                $wrapper.slideDown(300);
            }
        } else {
            // Slide up the inline wrapper (contains both global button + panel as one unit),
            // then slide down collapsed view.
            const $wrapper = this.$element.find('.inline-opt-wrapper');
            $(document).off('click.inline-dropdown');

            // Detach the wrapper to preserve its animation state across render()
            const wrapperEl = $wrapper.detach();

            // Render the collapsed view (wrapper is detached, so safe).
            // After render(), the gear icon is emitted WITHOUT .settings-open
            // because this.inlineSettingsOpen is false. That means the icon
            // would snap back to the un-rotated state instead of animating.
            // We compensate below by temporarily re-adding .settings-open then
            // removing it on the next frame to trigger the CSS transition.
            this.render();

            // Force counter-clockwise rotation animation on the freshly
            // rendered gear icon. Without this, the class change happens as
            // part of the DOM replacement and no transition is observed.
            const $icon = this.$element.find('.optimize-settings-icon');
            if ($icon.length) {
                $icon.addClass('settings-open');
                // Read a layout property to force the browser to commit the
                // above style, then strip the class on the next animation
                // frame so the transition plays.
                // eslint-disable-next-line no-unused-expressions
                $icon[0].offsetHeight;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        $icon.removeClass('settings-open');
                    });
                });
            }

            // Re-insert the wrapper (still at full height) into the optimize-container
            const $container = this.$element.find('.optimize-container');
            $container.append(wrapperEl);

            // Now slide everything simultaneously
            // - Quick Settings header + content + selectors slide DOWN
            // - Inline wrapper (global button + panel) slides UP as ONE unit
            // Respect the user's collapsed state: if Quick Settings was collapsed before
            // opening the inline panel, only slide the header down (content stays hidden).
            const wasQuickCollapsed = localStorage.getItem('quickOptSettingsCollapsed') === 'true';
            const $header = this.$element.find('.quick-opt-settings-header');
            const $content = this.$element.find('.quick-opt-settings-content');
            const $selectors = this.$element.find('.target-selector');
            const $budget = this.$element.find('.budget-section');

            if ($header.length) $header.hide().slideDown(250);
            if (!wasQuickCollapsed) {
                if ($content.length) $content.hide().slideDown(250);
                if ($selectors.length) $selectors.hide().slideDown(250);
                if ($budget.length) $budget.hide().slideDown(250);
            }
            // If collapsed, render() already emitted content with display:none and
            // the arrow without .expanded — nothing to animate.

            wrapperEl.slideUp(250, () => {
                wrapperEl.remove();
            });
        }
    }

    /**
     * Validate per-entry targets in sorting data against the current drop table.
     * Resets invalid activity drop targets to 'raw_rewards'.
     * Quality targets are universal and always valid.
     */
    _validateSortingTargets() {
        const settingsModal = window.settingsModal;
        if (!settingsModal) return;

        const targetDropKeys = new Set(['steps_per_reward_roll']);
        let changed = false;

        // Validate activity sorting targets against current drop table
        if (this.selectedActivity && this.dropTableData) {
            for (const entry of settingsModal.activitySorting) {
                const [key, weight, target] = entry;
                if (targetDropKeys.has(key) && target) {
                    // Category values (cat:*) are always valid — they're not activity-specific
                    if (target.startsWith('cat:')) continue;
                    // Legacy item name values: validate against drop table
                    if (target !== 'raw_rewards') {
                        const validDropNames = new Set();
                        for (const drop of this.dropTableData) {
                            if (drop.item_name !== 'Nothing') {
                                validDropNames.add(drop.item_name);
                                if (drop.has_fine_material) {
                                    validDropNames.add(`${drop.item_name} (Fine)`);
                                }
                            }
                        }
                        if (!validDropNames.has(target)) {
                            console.log(`[validateTargets] Resetting invalid legacy target "${target}" to null`);
                            entry[2] = null;
                            changed = true;
                        }
                    }
                }
            }
        }

        if (changed) {
            settingsModal.saveOptimizationSettings();
        }
    }

    /**
     * Get the instant-actions pet info for the current selection, if eligible.
     * Returns null if no eligible pet exists for the current skill type.
     * @returns {Object|null}
     */
    _getEligibleInstantActionsPet() {
        const catalog = this._petCatalog;
        if (!catalog || catalog.length === 0) return null;

        const ownedItems = store.state.items || {};

        // Determine skill type from current selection.
        // Try multiple sources in order of reliability.
        let skillType = null;

        if (this.selectedActivity) {
            // 1. Try activityInfoSection.activity (most accurate)
            const actSection = window.activityInfoSection;
            const activity = actSection?.activity;
            if (activity?.primary_skill) {
                skillType = activity.primary_skill.toLowerCase();
            }

            // 2. Fall back: look up from activitySelectorDropdown's loaded data
            if (!skillType && window.activitySelectorDropdown?.activitiesData) {
                const bySkill = window.activitySelectorDropdown.activitiesData.by_skill || {};
                for (const [skill, activities] of Object.entries(bySkill)) {
                    if (activities.some(a => a.id === this.selectedActivity)) {
                        skillType = skill.toLowerCase();
                        break;
                    }
                }
            }
        } else if (this.selectedRecipe && this.recipeData) {
            skillType = (this.recipeData.skill || '').toLowerCase();
        }

        if (!skillType) return null;

        // For smithing recipes, only show the checkbox for smelting recipes (bar smelting)
        if (skillType === 'smithing' && this.recipeData) {
            const recipeName = this.recipeData.name || '';
            if (!SMELTING_RECIPE_NAMES.has(recipeName)) return null;
        }

        // Use the imported getInstantActionsPet utility, passing user overrides
        // so manually-set pet levels (via Column 1 dropdown) are also checked
        const userOverrideItems = store.state.ui?.user_overrides?.items || {};
        const petInfo = getInstantActionsPet(skillType, ownedItems, catalog, userOverrideItems);
        if (!petInfo) return null;

        // Look up the user's custom pet name (e.g. "achinmin" instead of "Chicken")
        const itemState = ownedItems[petInfo.petId] || null;
        const overrideState = userOverrideItems[petInfo.petId] || null;
        const customName = overrideState?.petName || itemState?.petName || null;
        if (customName) {
            petInfo.displayName = customName;
        } else {
            petInfo.displayName = petInfo.petName;
        }

        return petInfo;
    }

    /**
     * Render the instant-actions checkbox HTML for a given panel location.
     * Returns '' if the pet is not eligible.
     * @param {'quick'|'inline'} panel
     * @returns {string} HTML string
     */
    _renderInstantActionsCheckbox(panel) {
        const petInfo = this._getEligibleInstantActionsPet();
        if (!petInfo) {
            // No instant-actions pet for this skill — fall back to an
            // ability-stats pet (e.g. Tiger "The Hunt Is On" for Hunting),
            // which adds flat stats rather than completing actions instantly.
            // These are mutually exclusive per skill, so at most one shows.
            return this._renderAbilityStatsCheckbox(panel);
        }

        // Use the current selection's skill type as the state key
        // (not the ability's skill, since smelting maps to smithing recipes)
        const skillType = this._getCurrentSkillType() || petInfo.skillKey || petInfo.petId;
        const isChecked = this._getInstantActionsChecked(skillType);
        const checkedAttr = isChecked ? 'checked' : '';

        // Build rich popover HTML (set via dataset.infoHtml after render, like Tiger ability)
        // Store it so attachEvents() can wire it
        this._instantActionsPopoverHtml = this._buildInstantActionsPopoverHtml(petInfo);

        return `
            <div class="instant-actions-checkbox-row" data-panel="${panel}" data-skill="${skillType}">
                <label class="instant-actions-label">
                    <input type="checkbox" class="instant-actions-checkbox" data-skill="${skillType}" ${checkedAttr}>
                    For ${petInfo.displayName}'s ability (${petInfo.species})
                    <span class="travel-info-icon instant-actions-info-icon" role="button" tabindex="0" aria-label="About this ability">ⓘ</span>
                </label>
            </div>
        `;
    }

    /**
     * Get the ability-stats pet info for the current selection, if eligible.
     * These are pets whose activatable ability grants flat stats for a skill
     * (e.g. Tiger "The Hunt Is On" for Hunting), as opposed to instant-actions
     * pets. Returns null if no eligible pet exists for the current skill type.
     * @returns {Object|null}
     */
    _getEligibleAbilityStatsPet() {
        const catalog = this._petCatalog;
        if (!catalog || catalog.length === 0) return null;

        const ownedItems = store.state.items || {};
        const skillType = this._getCurrentSkillType();
        if (!skillType) return null;

        const userOverrideItems = store.state.ui?.user_overrides?.items || {};
        const petInfo = getAbilityStatsPet(skillType, ownedItems, catalog, userOverrideItems);
        if (!petInfo) return null;

        // Look up the user's custom pet name (e.g. "stripes" instead of "Tiger")
        const itemState = ownedItems[petInfo.petId] || null;
        const overrideState = userOverrideItems[petInfo.petId] || null;
        const customName = overrideState?.petName || itemState?.petName || null;
        petInfo.displayName = customName || petInfo.petName;
        return petInfo;
    }

    /**
     * Render the ability-stats pet checkbox HTML for a given panel location.
     * Returns '' if no eligible ability-stats pet for the current skill.
     *
     * The outer row reuses the `instant-actions-checkbox-row` class and the
     * info icon reuses `instant-actions-info-icon` so all existing injection /
     * de-dupe / popover-wiring sites work unchanged. The inner checkbox uses a
     * distinct `ability-stats-checkbox` class so its own change handler fires.
     * @param {'quick'|'inline'} panel
     * @returns {string} HTML string
     */
    _renderAbilityStatsCheckbox(panel) {
        const petInfo = this._getEligibleAbilityStatsPet();
        if (!petInfo) return '';

        const skillType = this._getCurrentSkillType() || petInfo.skillKey || petInfo.petId;
        const isChecked = this._getAbilityStatsChecked(skillType);
        const checkedAttr = isChecked ? 'checked' : '';

        // Reuse the instant-actions popover field so the shared wiring picks it up
        this._instantActionsPopoverHtml = this._buildAbilityStatsPopoverHtml(petInfo);

        return `
            <div class="instant-actions-checkbox-row ability-stats-checkbox-row" data-panel="${panel}" data-skill="${skillType}">
                <label class="instant-actions-label">
                    <input type="checkbox" class="ability-stats-checkbox" data-skill="${skillType}" ${checkedAttr}>
                    Use ${petInfo.displayName}'s ability (${petInfo.species})
                    <span class="travel-info-icon instant-actions-info-icon" role="button" tabindex="0" aria-label="About this ability">ⓘ</span>
                </label>
            </div>
        `;
    }

    /**
     * Render the "Run optimization locally" checkbox for the quick-settings
     * panel (FAC-gated). Mirrors window.settingsModal.runLocalOptimization and
     * is synced across surfaces via the runLocalOptimizationChanged event.
     */
    _renderRunLocalCheckbox() {
        if (!(window._featureFlags && window._featureFlags.local_optimization)) return '';
        const checked = (window.settingsModal && window.settingsModal.runLocalOptimization) ? 'checked' : '';
        return `
            <div class="opt-run-local-row" style="margin-top:6px;padding:6px 0 4px 0;text-align:center;">
                <label style="display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:0.85em;color:var(--text-secondary);cursor:pointer;user-select:none;">
                    <input type="checkbox" class="opt-run-local-checkbox" style="flex-shrink:0;cursor:pointer;" ${checked} />
                    Run optimization locally
                    <span class="travel-info-icon" data-info="Runs the optimizer in your browser instead of on the server. On a reasonably modern phone or computer this is usually faster, and it reduces server load. Older or low-end devices may be slower than the server. Results are identical to a server run, and once finished they're saved to the server, so they're available on all your devices." role="button" tabindex="0" aria-label="About running locally">ⓘ</span>
                </label>
            </div>
        `;
    }

    /**
     * Build rich HTML for the instant-actions ability info popover.
     * Matches the Tiger ability popup style.
     */
    _buildInstantActionsPopoverHtml(petInfo) {
        let html = `<div class="info-popover-title">${petInfo.abilityName}</div>`;

        // Effect line
        html += `<div class="pet-popover-duration">${petInfo.effect}</div>`;

        // Cooldown
        if (petInfo.cooldown) {
            // Format the cooldown: "4,000 stepsNot doing Agility." → "4,000 steps (Not doing Agility)"
            // The scraper concatenates the step count and condition without a space
            const cooldownFormatted = petInfo.cooldown
                .replace(/(\d[\d,]*\s*steps?)(While|Not|While\s+in)/gi, '$1 ($2')
                .replace(/\.$/, '')
                + (petInfo.cooldown.match(/(While|Not)\s+/i) ? ')' : '');
            html += `<div class="pet-popover-inputs"><div class="pet-popover-inputs-header">Cooldown: ${cooldownFormatted}</div></div>`;
        }

        // Charges
        if (petInfo.charges) {
            html += `<div class="pet-popover-inputs"><div class="pet-popover-inputs-header">Charges: ${petInfo.charges}</div></div>`;
        }

        return html;
    }

    /**
     * Returns true if instant-actions mode should be sent with the current optimize request.
    * Re-checks eligibility at optimize time.
    * @returns {boolean}
    */
    _getInstantActionsFlag() {
        const petInfo = this._getEligibleInstantActionsPet();
        if (!petInfo) return false;
        const skillType = this._getCurrentSkillType() || petInfo.skillKey || petInfo.petId;
        return this._getInstantActionsChecked(skillType);
    }

    /**
     * Get the current skill type from the selected activity or recipe.
     * @returns {string|null}
     */
    _getCurrentSkillType() {
        if (this.selectedActivity) {
            const actSection = window.activityInfoSection;
            if (actSection?.activity?.primary_skill) {
                return actSection.activity.primary_skill.toLowerCase();
            }
            if (window.activitySelectorDropdown?.activitiesData) {
                const bySkill = window.activitySelectorDropdown.activitiesData.by_skill || {};
                for (const [skill, activities] of Object.entries(bySkill)) {
                    if (activities.some(a => a.id === this.selectedActivity)) {
                        return skill.toLowerCase();
                    }
                }
            }
        } else if (this.selectedRecipe && this.recipeData) {
            return (this.recipeData.skill || '').toLowerCase();
        }
        return null;
    }

    /**
     * Get the instant-actions checked state for a given skill type.
     * @param {string} skillType
     * @returns {boolean}
     */
    _getInstantActionsChecked(skillType) {
        if (skillType === 'foraging') return this.instantActionsForaging;
        if (skillType === 'smithing' || skillType === 'smelting') return this.instantActionsSmelting;
        return false;
    }

    /**
     * Get the ability-stats checked state for a given skill type. Persisted
     * per-skill in session config under `ability_stats_<skill>` (loaded back
     * into store.state.ui), so this reads directly from the store.
     * @param {string} skillType
     * @returns {boolean}
     */
    _getAbilityStatsChecked(skillType) {
        if (!skillType) return false;
        const ui = store.state.ui || {};
        return !!ui[`ability_stats_${skillType}`];
    }

    /**
     * Returns true if ability-stats mode should be sent with the current
     * optimize request. Re-checks eligibility at optimize time.
     * @returns {boolean}
     */
    _getAbilityStatsFlag() {
        const petInfo = this._getEligibleAbilityStatsPet();
        if (!petInfo) return false;
        const skillType = this._getCurrentSkillType() || petInfo.skillKey || petInfo.petId;
        return this._getAbilityStatsChecked(skillType);
    }

    /**
     * Build rich HTML for the ability-stats pet info popover (e.g. Tiger).
     * Matches the Column-2 pet ability popover style (gear-slot-grid).
     */
    _buildAbilityStatsPopoverHtml(petInfo) {
        const iconMap = {
            'work_efficiency': 'work_efficiency', 'double_action': 'double_action',
            'double_rewards': 'double_rewards', 'steps_add': 'steps_required',
            'steps_required': 'steps_required', 'flat_steps': 'steps_required',
            'steps_pct': 'steps_required', 'steps_percent': 'steps_required',
            'no_materials_consumed': 'no_materials_consumed', 'quality_outcome': 'quality_outcome',
            'bonus_xp': 'bonus_experience', 'bonus_xp_percent': 'bonus_experience',
            'bonus_experience': 'bonus_experience', 'chest_finding': 'chest_finding',
            'item_finding': 'item_finding', 'fine_material_finding': 'fine_material_finding',
            'find_collectibles': 'find_collectibles', 'inventory_space': 'inventory_space',
        };
        const percentageStats = [
            'work_efficiency', 'double_action', 'double_rewards', 'no_materials_consumed',
            'bonus_xp', 'bonus_xp_percent', 'chest_finding', 'item_finding',
            'fine_material_finding', 'find_collectibles',
        ];
        const formatName = (stat) => stat.split('_').map(w => {
            if (w === 'xp') return 'XP';
            return w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');

        let html = `<div class="info-popover-title">${petInfo.abilityName}</div>`;
        if (petInfo.duration) {
            html += `<div class="pet-popover-duration">Lasts ${petInfo.duration} ${petInfo.durationUnit || 'actions'}</div>`;
        }

        const stats = petInfo.abilityStats || {};
        html += `<div class="pet-popover-stats">`;
        for (const [skill, locations] of Object.entries(stats)) {
            for (const [location, statVals] of Object.entries(locations)) {
                const skillName = skill === 'global' ? '' : (skill.charAt(0).toUpperCase() + skill.slice(1));
                const locName = location === 'global' ? '' : location;
                let conditionText = '';
                if (skillName) conditionText += `While doing ${skillName}`;
                if (locName) conditionText += `${conditionText ? ' ' : 'While '}in ${locName}`;
                if (conditionText) {
                    html += `<div class="pet-popover-condition">${conditionText}</div>`;
                }
                for (const [stat, value] of Object.entries(statVals)) {
                    const iconFile = iconMap[stat] || stat;
                    const name = formatName(stat);
                    const isPercent = percentageStats.includes(stat);
                    const sign = value > 0 ? '+' : '';
                    const suffix = isPercent ? '%' : '';
                    // Steps stats: negative = good (green); everything else: positive = good
                    const isStepsStat = stat.includes('steps');
                    const isGood = isStepsStat ? value < 0 : value > 0;
                    const colorClass = isGood ? 'stat-positive' : 'stat-negative';
                    html += `
                        <div class="pet-popover-stat-row">
                            <span class="${colorClass}">${sign}${value}${suffix}</span>
                            <img src="/assets/icons/attributes/${iconFile}.svg" class="pet-popover-stat-icon" alt="${name}">
                            <span>${name}</span>
                        </div>
                    `;
                }
            }
        }
        html += `</div>`;

        // Input requirements (items needed to charge the ability). Mirrors the
        // Column-2 pet ability popover (gear-slot-grid.js _buildAbilityPopoverHtml):
        // e.g. Tiger's "Charged by items. One full charge requires 10 ..." with
        // per-material rows. Falls back to a plain "Charges: N" line otherwise.
        if (petInfo.cooldown && petInfo.cooldown.includes('charged by using items')) {
            const cooldown = petInfo.cooldown;
            const chargeMatch = cooldown.match(/requires.*?(\d+)/);
            const chargeNeeded = chargeMatch ? chargeMatch[1] : '?';
            const items = [];
            const itemRegex = /(\d+)\s+gained from\s+([A-Z][a-z][\w\s]*?)(?=\s+\d+\s+gained|\s*$)/g;
            let m;
            while ((m = itemRegex.exec(cooldown)) !== null) {
                items.push({ qty: m[1], name: m[2].trim() });
            }
            const drIcon = '/assets/icons/attributes/double_rewards.svg';
            html += `<div class="pet-popover-inputs">`;
            html += `<div class="pet-popover-inputs-header">Charged by items. One full charge requires <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge"> <strong>${chargeNeeded}</strong></div>`;
            for (const item of items) {
                const iconName = item.name.toLowerCase().replace(/ /g, '_');
                html += `
                    <div class="pet-popover-input-row">
                        <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge">
                        <strong>${item.qty}</strong> gained from
                        <img src="/assets/icons/items/materials/${iconName}.svg" class="pet-popover-stat-icon" alt="${item.name}"
                             onerror="this.src='/assets/icons/items/consumables/${iconName}.svg'; this.onerror=null;">
                        ${item.name}
                    </div>
                `;
            }
            html += `</div>`;
        } else if (petInfo.charges) {
            html += `<div class="pet-popover-inputs"><div class="pet-popover-inputs-header">Charges: ${petInfo.charges}</div></div>`;
        }
        return html;
    }

    /**
     * Persist instant-actions state to session config.
     * @param {string} skillType - 'foraging' or 'smelting'
     * @param {boolean} value
     */
    async _saveInstantActionsState(skillType, value) {
        // Use 'ui.' prefix so it's stored in ui_config and loaded back into store.state.ui
        const key = `ui.instant_actions_${skillType}`;
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            await api.updateConfig(uuid, key, value);
        } catch (e) {
            console.warn('[InstantActions] Failed to persist state:', e);
        }
    }

    /**
     * Mount (or re-mount) the X-per-Y recipe priority list into the
     * inline Detailed panel (opened via the gear icon on Column 3).
     */
    _mountXyRecipeInlinePanel() {
        const $mount = this.$element.find('.xy-recipe-inline-mount[data-mount-id="optimize-button-inline"]');
        if (!$mount.length) {
            if (this._xyInlineController) {
                try { this._xyInlineController.destroy(); } catch (e) { /* noop */ }
                this._xyInlineController = null;
            }
            return;
        }
        if (this._xyInlineController) {
            try { this._xyInlineController.destroy(); } catch (e) { /* noop */ }
            this._xyInlineController = null;
        }

        const settingsModal = window.settingsModal;
        const entries = settingsModal?.recipeSorting || [];
        const includeItemFinding = !!settingsModal?.showItemFindingDrops;

        this._xyInlineController = mountXyPriorityList($mount, {
            entries,
            mode: 'detailed',
            includeItemFinding,
            isQualityRecipe: this.isQualityRecipe(),
            recipeSkill: this.recipeData?.skill || null,
            recipeDropTable: this.recipeData?.drop_table || null,
            onChange: (newEntries) => {
                if (!settingsModal) return;
                settingsModal.recipeSorting = newEntries;
                // NOTE: we deliberately do NOT call setEntries() on sibling
                // controllers (settings modal + quick panel) here. Weight
                // sliders fire `input` events on every pixel, and each
                // setEntries() → render() on a sibling mount rebuilds its
                // HTML + captures/restores scroll via rAF. When the quick
                // panel is slideUp'd behind the inline panel (same DOM),
                // `findScrollableAncestor` on the hidden mount still
                // resolves to Column 3, and the rAF-restore races the
                // user's interaction — causing visible scroll jitter and
                // a laggy slider feel versus the activity slider which
                // does no cross-mount work. Only one of these mounts is
                // visible at a time in practice, and each rebuilds fresh
                // (settings modal show() re-fetches from server; quick
                // and inline mounts read from settingsModal.recipeSorting
                // on creation). Sync is therefore unnecessary.
                clearTimeout(this._xyInlineSaveTimer);
                this._xyInlineSaveTimer = setTimeout(() => {
                    this._skipSettingsRerender = true;
                    const done = settingsModal.saveOptimizationSettings();
                    const clearFlag = () => { this._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Mount (or re-mount) the X-per-Y recipe priority list into the
     * Column 3 Quick panel for recipe mode. No-op if the mount point
     * isn't present (e.g. activity mode, inline settings open, no
     * recipe selected).
     */
    _mountXyRecipeQuickPanel() {
        const $mount = this.$element.find('.xy-recipe-quick-mount[data-mount-id="optimize-button-quick"]');
        if (!$mount.length) {
            if (this._xyQuickController) {
                // Remember which groups were expanded so when the panel
                // re-mounts (e.g. after a save-triggered parent re-render)
                // the state is restored instead of collapsing.
                try { this._savedQuickExpandedGroups = this._xyQuickController.getExpandedGroups(); } catch (e) { /* noop */ }
                try { this._xyQuickController.destroy(); } catch (e) { /* noop */ }
                this._xyQuickController = null;
            }
            return;
        }
        // Capture the current expanded state before destroy. This fixes
        // issue #1 — duplicating inside an expanded quality group used to
        // collapse it because saveOptimizationSettings → optimizationSettings-
        // Loaded → optimize-button.render() destroys and recreates the
        // controller, losing its in-memory expanded set.
        let savedExpanded = this._savedQuickExpandedGroups || null;
        if (this._xyQuickController) {
            try { savedExpanded = this._xyQuickController.getExpandedGroups(); } catch (e) { /* noop */ }
            try { this._xyQuickController.destroy(); } catch (e) { /* noop */ }
            this._xyQuickController = null;
        }
        this._savedQuickExpandedGroups = null;

        const settingsModal = window.settingsModal;
        const entries = settingsModal?.recipeSorting || [];
        const includeItemFinding = !!settingsModal?.showItemFindingDrops;

        this._xyQuickController = mountXyPriorityList($mount, {
            entries,
            mode: 'quick',
            includeItemFinding,
            isQualityRecipe: this.isQualityRecipe(),
            recipeSkill: this.recipeData?.skill || null,
            recipeDropTable: this.recipeData?.drop_table || null,
            initialExpandedGroups: savedExpanded,
            globalEditSlot: this.$element.find('.quick-opt-edit-bar-slot[data-slot="xy-global-edit"]').first(),
            onChange: (newEntries) => {
                // Persist through the settings-modal so both panels stay
                // in sync and the save endpoint sees the dict form. The
                // settings-modal debounces saves at 300ms.
                if (!settingsModal) return;
                settingsModal.recipeSorting = newEntries;
                // NOTE: intentionally NOT calling setEntries() on the
                // settings modal's controller here — see the inline
                // panel's onChange for the full rationale. In short:
                // weight sliders fire `input` on every pixel, and each
                // cross-mount render() captures/restores scroll via rAF,
                // racing the user's interaction and making the slider
                // feel laggy vs the activity slider. settingsModal.show()
                // re-fetches fresh data, so the modal won't show stale
                // values when next opened.
                clearTimeout(this._xyQuickSaveTimer);
                this._xyQuickSaveTimer = setTimeout(() => {
                    // Suppress the optimizationSettingsLoaded re-render
                    // cycle fired by saveOptimizationSettings — our own
                    // save shouldn't tear down the mount we're interacting
                    // with (that was resetting Quick-panel scroll to the
                    // top on every edit).
                    this._skipSettingsRerender = true;
                    const done = settingsModal.saveOptimizationSettings();
                    const clearFlag = () => { this._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Mount (or re-mount) the X-per-Y activity priority list into the
     * inline Detailed panel (opened via the gear icon on Column 3 when
     * activity mode is active).
     */
    _mountXyActivityInlinePanel() {
        const $mount = this.$element.find('.xy-activity-inline-mount[data-mount-id="optimize-button-inline"]');
        if (!$mount.length) {
            if (this._xyActivityInlineController) {
                try { this._xyActivityInlineController.destroy(); } catch (e) { /* noop */ }
                this._xyActivityInlineController = null;
            }
            return;
        }
        if (this._xyActivityInlineController) {
            try { this._xyActivityInlineController.destroy(); } catch (e) { /* noop */ }
            this._xyActivityInlineController = null;
        }

        const settingsModal = window.settingsModal;
        const entries = settingsModal?.activitySorting || [];
        const includeItemFinding = !!settingsModal?.showItemFindingDrops;

        this._xyActivityInlineController = mountXyActivityPriorityList($mount, {
            entries,
            mode: 'detailed',
            includeItemFinding,
            activityDropTable: this.dropTableData || null,
            onChange: (newEntries) => {
                if (!settingsModal) return;
                settingsModal.activitySorting = newEntries;
                clearTimeout(this._xyActivityInlineSaveTimer);
                this._xyActivityInlineSaveTimer = setTimeout(() => {
                    this._skipSettingsRerender = true;
                    const done = settingsModal.saveOptimizationSettings();
                    const clearFlag = () => { this._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Mount (or re-mount) the X-per-Y activity priority list into the
     * Column 3 Quick panel for activity mode.
     */
    _mountXyActivityQuickPanel() {
        const $mount = this.$element.find('.xy-activity-quick-mount[data-mount-id="optimize-button-quick"]');
        if (!$mount.length) {
            if (this._xyActivityQuickController) {
                try { this._savedActivityQuickExpandedGroups = this._xyActivityQuickController.getExpandedGroups(); } catch (e) { /* noop */ }
                try { this._xyActivityQuickController.destroy(); } catch (e) { /* noop */ }
                this._xyActivityQuickController = null;
            }
            return;
        }
        let savedExpanded = this._savedActivityQuickExpandedGroups || null;
        if (this._xyActivityQuickController) {
            try { savedExpanded = this._xyActivityQuickController.getExpandedGroups(); } catch (e) { /* noop */ }
            try { this._xyActivityQuickController.destroy(); } catch (e) { /* noop */ }
            this._xyActivityQuickController = null;
        }
        this._savedActivityQuickExpandedGroups = null;

        const settingsModal = window.settingsModal;
        const entries = settingsModal?.activitySorting || [];
        const includeItemFinding = !!settingsModal?.showItemFindingDrops;

        this._xyActivityQuickController = mountXyActivityPriorityList($mount, {
            entries,
            mode: 'quick',
            includeItemFinding,
            activityDropTable: this.dropTableData || null,
            initialExpandedGroups: savedExpanded,
            globalEditSlot: this.$element.find('.quick-opt-edit-bar-slot[data-slot="xy-global-edit"]').first(),
            onChange: (newEntries) => {
                if (!settingsModal) return;
                settingsModal.activitySorting = newEntries;
                clearTimeout(this._xyActivityQuickSaveTimer);
                this._xyActivityQuickSaveTimer = setTimeout(() => {
                    this._skipSettingsRerender = true;
                    const done = settingsModal.saveOptimizationSettings();
                    const clearFlag = () => { this._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Shared mount helper for the travel priority list. `mountSelector` picks
     * the Quick (.travel-quick-mount) or Detailed (.travel-detailed-mount)
     * container; `mode` is 'quick' or 'detailed'. Reads/writes
     * window.settingsModal.travelSorting and persists via the debounced
     * saveOptimizationSettings (which sends travel_sorting).
     */
    _mountTravelPanel(mountSelector, controllerKey, mode) {
        const $mount = this.$element.find(mountSelector);
        if (!$mount.length) {
            if (this[controllerKey]) {
                try { this[controllerKey].destroy(); } catch (e) { /* noop */ }
                this[controllerKey] = null;
            }
            return;
        }
        if (this[controllerKey]) {
            try { this[controllerKey].destroy(); } catch (e) { /* noop */ }
            this[controllerKey] = null;
        }

        const settingsModal = window.settingsModal;
        const entries = (settingsModal && Array.isArray(settingsModal.travelSorting) && settingsModal.travelSorting.length)
            ? settingsModal.travelSorting
            : defaultTravelEntries();

        this[controllerKey] = mountTravelPriorityList($mount, {
            entries,
            mode,
            onChange: (newEntries) => {
                if (!settingsModal) return;
                settingsModal.travelSorting = newEntries;
                clearTimeout(this._travelSaveTimer);
                this._travelSaveTimer = setTimeout(() => {
                    // Suppress the optimizationSettingsLoaded-driven re-render so
                    // editing the panel doesn't tear down the mount mid-interaction.
                    this._skipSettingsRerender = true;
                    const done = settingsModal.saveOptimizationSettings();
                    const clearFlag = () => { this._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /** Mount the travel Quick panel (weight + target edits only). */
    _mountTravelQuickPanel() {
        this._mountTravelPanel('.travel-quick-mount[data-mount-id="optimize-button-quick"]', '_travelQuickController', 'quick');
    }

    /** Mount the travel Detailed panel (add / duplicate / remove / reorder). */
    _mountTravelDetailedPanel() {
        this._mountTravelPanel('.travel-detailed-mount[data-mount-id="optimize-button-inline"]', '_travelDetailedController', 'detailed');
    }

    /**
     * Render the inline optimization settings panel below the optimize button
     */
    _renderInlineSettings(hideIndex = null) {
        // Inject shared reorder-strip styles so the activity inline panel's
        // up/down arrows render correctly. Recipe-path mount injects these
        // on its own via mountXyPriorityList, but activity reuses the
        // legacy sortItems rendering which wouldn't otherwise pick them up.
        ensureXyStyles();

        const settingsModal = window.settingsModal;
        if (!settingsModal) return;

        // Travel mode: selectedActivity === 'traveling' would otherwise make
        // isActivity true below and render the ACTIVITY detailed panel (bug:
        // gear opened "Activity Optimization" for travel). Handle travel first
        // with its own 2-metric detailed panel, mirroring the recipe branch's
        // wrapper/mount/reset structure (no preset bar — travel has no presets).
        if (this.isTravelActivity()) {
            const $existingPanel = this.$element.find('.inline-opt-settings').first();
            this.$element.find('.inline-floating-dropdown').remove();
            $(document).off('click.inline-dropdown');
            const html = `
                <div class="inline-opt-settings" data-type="travel">
                    <div class="inline-opt-header">
                        <span class="inline-opt-title">Travel Optimization</span>
                    </div>
                    <div class="travel-detailed-mount" data-mount-id="optimize-button-inline"></div>
                    <button class="sort-reset-btn travel-sort-reset-btn" data-list="travel-sort-list">↺ Reset to Default</button>
                </div>
            `;
            if ($existingPanel.length) {
                $existingPanel.replaceWith(html);
            } else {
                this.$element.find('.optimize-container').append(html);
            }
            this._mountTravelDetailedPanel();
            this._ensureInlineOptWrapper();
            const $panel = this.$element.find('.inline-opt-settings');
            $panel.off('click.travelreset').on('click.travelreset', '.travel-sort-reset-btn', (e) => {
                e.preventDefault();
                e.stopPropagation();
                settingsModal.travelSorting = defaultTravelEntries();
                settingsModal.saveOptimizationSettings();
                if (this._travelDetailedController) {
                    this._travelDetailedController.setEntries(settingsModal.travelSorting);
                }
            });
            return;
        }

        const isActivity = !!this.selectedActivity;
        const isRecipe = !!this.selectedRecipe;
        const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
        const options = isActivity ? settingsModal.sortingOptions.activity : settingsModal.sortingOptions.recipe;
        const listClass = isActivity ? 'activity-sort-list' : 'recipe-sort-list';
        const presetType = isActivity ? 'activity' : 'recipe';

        // If sorting options haven't loaded yet (async race on page load), bail out.
        // The optimizationSettingsLoaded event will trigger a re-render once they arrive.
        if (!sorting || sorting.length === 0 || !options || options.length === 0) return;

        // Recipe mode: the inline Detailed panel is rendered by the shared
        // X-per-Y component. We build the outer inline-opt-settings wrapper
        // (so preset bar, reset button, and animation all work), then mount
        // the component into the inner list area. Everything else below
        // this block is the legacy activity-only rendering.
        if (isRecipe) {
            const $existingPanel = this.$element.find('.inline-opt-settings').first();
            this.$element.find('.inline-floating-dropdown').remove();
            $(document).off('click.inline-dropdown');
            const presetBarHtml = settingsModal.renderPresetBar('recipe');
            const html = `
                <div class="inline-opt-settings" data-type="recipe">
                    <div class="inline-opt-header">
                        <span class="inline-opt-title">Recipe Optimization</span>
                    </div>
                    ${presetBarHtml}
                    <div class="xy-recipe-inline-mount" data-mount-id="optimize-button-inline"></div>
                    <button class="sort-reset-btn" data-list="recipe-sort-list">↺ Reset to Default</button>
                </div>
            `;
            if ($existingPanel.length) {
                $existingPanel.replaceWith(html);
            } else {
                this.$element.find('.optimize-container').append(html);
            }

            // Inject instant-actions checkbox into the wrapper (same logic as
            // the activity path below, kept in sync for recipe).
            const instantActionsHtmlInline = this._renderInstantActionsCheckbox('inline');
            this.$element.find('.inline-opt-wrapper .instant-actions-checkbox-row').remove();
            if (instantActionsHtmlInline) {
                const $wrapper = this.$element.find('.inline-opt-wrapper');
                if ($wrapper.length) {
                    $wrapper.find('.open-global-opt-settings-btn').before($(instantActionsHtmlInline));
                    if (this._instantActionsPopoverHtml) {
                        $wrapper.find('.instant-actions-info-icon').each((_, el) => {
                            el.dataset.infoHtml = this._instantActionsPopoverHtml;
                        });
                        wireInfoIcons($wrapper[0]);
                    }
                }
            }

            // Mount the XY Detailed component into the placeholder.
            this._mountXyRecipeInlinePanel();

            // Ensure the .inline-opt-wrapper (containing the "Open Global
            // Optimization Settings" button) exists around the panel.
            // This is normally created by the gear icon toggle, but on a
            // page reload with inlineSettingsOpen=true the panel is built
            // by _renderInlineSettings without the wrapper, so the global
            // button goes missing (bug report item #5). Idempotent.
            this._ensureInlineOptWrapper();

            // Wire the shared inline-panel events (preset bar save/load,
            // export/import, reset button). The activity path calls this
            // at the end of this method — for the recipe path we have to
            // call it explicitly before the early return, otherwise the
            // preset bar and reset button in the recipe inline panel get
            // no click/input handlers (issues #5 and #6).
            this._attachInlineSettingsEvents();
            return;
        }

        // Activity mode: same X-per-Y treatment as recipe — the inline
        // Detailed panel is now driven by the shared activity component
        // (mountXyActivityPriorityList). Same wrapper/preset-bar/reset
        // structure, different mount point and entries source.
        if (isActivity) {
            const $existingPanel = this.$element.find('.inline-opt-settings').first();
            this.$element.find('.inline-floating-dropdown').remove();
            $(document).off('click.inline-dropdown');
            const presetBarHtml = settingsModal.renderPresetBar('activity');
            const html = `
                <div class="inline-opt-settings" data-type="activity">
                    <div class="inline-opt-header">
                        <span class="inline-opt-title">Activity Optimization</span>
                    </div>
                    ${presetBarHtml}
                    <div class="xy-activity-inline-mount" data-mount-id="optimize-button-inline"></div>
                    <button class="sort-reset-btn" data-list="activity-sort-list">↺ Reset to Default</button>
                </div>
            `;
            if ($existingPanel.length) {
                $existingPanel.replaceWith(html);
            } else {
                this.$element.find('.optimize-container').append(html);
            }

            // Instant-actions checkbox (same as recipe path).
            const instantActionsHtmlInline = this._renderInstantActionsCheckbox('inline');
            this.$element.find('.inline-opt-wrapper .instant-actions-checkbox-row').remove();
            if (instantActionsHtmlInline) {
                const $wrapper = this.$element.find('.inline-opt-wrapper');
                if ($wrapper.length) {
                    $wrapper.find('.open-global-opt-settings-btn').before($(instantActionsHtmlInline));
                    if (this._instantActionsPopoverHtml) {
                        $wrapper.find('.instant-actions-info-icon').each((_, el) => {
                            el.dataset.infoHtml = this._instantActionsPopoverHtml;
                        });
                        wireInfoIcons($wrapper[0]);
                    }
                }
            }

            this._mountXyActivityInlinePanel();
            this._ensureInlineOptWrapper();
            this._attachInlineSettingsEvents();
            return;
        }

        // Locate any existing panel so we can replace it in-place rather than
        // blindly appending. Without in-place replacement, repeated calls
        // accumulate duplicate panels (each with their own delegated handlers
        // and document-level listeners), manifesting as dozens of duplicate
        // rows, stale target values, and ghost open/close toggles.
        const $existingPanel = this.$element.find('.inline-opt-settings').first();
        // Clear any stale floating dropdowns left over from the outgoing panel.
        this.$element.find('.inline-floating-dropdown').remove();
        // Clean up the document-level outside-click listener bound by
        // _attachInlineSettingsEvents() so it doesn't accumulate either.
        $(document).off('click.inline-dropdown');

        // Build sort items with inline target/budget controls embedded
        const isSingle = sorting.length <= 1;
        const usedKeys = new Set(sorting.map(entry => entry[0]));
        const availableOptions = options.filter(opt => opt.duplicable || !usedKeys.has(opt.key));

        // Keys that get embedded controls
        const targetDropKeys = new Set(['steps_per_reward_roll']);
        const targetQualityKeys = new Set(['materials_for_target', 'steps_for_target', 'total_crafts']);
        const budgetKeys = new Set(['steps_for_budget']);

        const sortItems = sorting.map((entry, index) => {
            const [key, weight, target] = entry;
            const option = options.find(opt => opt.key === key);
            if (!option) return '';

            const duplicateBtn = option.duplicable
                ? `<button class="sort-duplicate-btn" title="Duplicate this priority">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                        <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                    </svg>
                   </button>`
                : `<span class="sort-duplicate-placeholder"></span>`;

            let embeddedControl = '';

            // Embed target drop selector under steps_per_reward_roll (activity only)
            if (isActivity && targetDropKeys.has(key)) {
                const entryTarget = target || 'cat:normal_items';
                embeddedControl = this._renderInlineTargetDrop(entryTarget, index);
            }

            // Embed target quality selector under quality metrics (recipe only)
            // Show the dropdown even for non-quality recipes to stay consistent with
            // the Settings modal view. The optimizer filters out quality-specific
            // priorities for non-quality recipes anyway, so selection is harmless.
            if (isRecipe && targetQualityKeys.has(key)) {
                const entryTarget = target || 'Perfect';
                embeddedControl = this._renderInlineTargetQuality(entryTarget, index);
            }

            // Embed budget inputs under budget metric (recipe only)
            if (isRecipe && budgetKeys.has(key)) {
                embeddedControl = this._renderInlineBudget();
            }

            const targetAttr = target ? ` data-target="${target}"` : '';
            const hideStyle = (hideIndex !== null && index === hideIndex) ? ' style="display:none;"' : '';

            // Reorder strip — same 30/5/30/5/30 layout used by the Recipe
            // XY panel and the Settings modal activity list. Keeps reorder
            // affordances consistent across every place priorities appear.
            const atTop = index === 0;
            const atBottom = index === sorting.length - 1;
            const reorderStrip = `
                <div class="xy-reorder-strip">
                    <button class="xy-move-up" ${atTop ? 'disabled' : ''} title="Move up" data-index="${index}" data-list-class="${listClass}" tabindex="-1">▲</button>
                    <span class="drag-handle" title="Drag to reorder">☰</span>
                    <button class="xy-move-down" ${atBottom ? 'disabled' : ''} title="Move down" data-index="${index}" data-list-class="${listClass}" tabindex="-1">▼</button>
                </div>
            `;

            return `
                <div class="sort-item" data-key="${key}" data-index="${index}" data-weight="${weight}"${targetAttr}${hideStyle}>
                    ${reorderStrip}
                    <div class="sort-item-content">
                        <span class="sort-name">${option.display_name}</span>
                        <div class="sort-weight-row">
                            <input type="range" class="weight-slider" min="0" max="100" value="${weight}" />
                            <input type="number" class="weight-input" min="0" max="100" value="${weight}" />
                            <span class="weight-pct">%</span>
                        </div>
                        ${embeddedControl}
                    </div>
                    ${duplicateBtn}
                    <button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority">✕</button>
                </div>
            `;
        }).join('');

        // Add button dropdown
        const addDropdownOptions = availableOptions.map(opt =>
            `<option value="${opt.key}">${opt.display_name}</option>`
        ).join('');

        const addButton = availableOptions.length > 0 ? `
            <div class="sort-add-wrapper">
                <button class="sort-add-btn" title="Add optimization priority">+ Add Optimization Priority</button>
                <select class="sort-add-dropdown" style="display:none;">
                    <option value="">Select a metric...</option>
                    ${addDropdownOptions}
                </select>
            </div>
        ` : '';

        // Preset bar
        const presetBarHtml = settingsModal.renderPresetBar(presetType);

        const html = `
            <div class="inline-opt-settings" data-type="${presetType}">
                <div class="inline-opt-header">
                    <span class="inline-opt-title">${isActivity ? 'Activity' : 'Recipe'} Optimization</span>
                </div>
                ${presetBarHtml}
                ${addButton}
                <div class="sort-list inline-sort-list ${listClass}">
                    ${sortItems}
                </div>
                <button class="sort-reset-btn" data-list="${listClass}">↺ Reset to Default</button>
            </div>
        `;

        // Insert after the optimize button, or replace the existing panel in
        // its current position (which may be inside .inline-opt-wrapper).
        if ($existingPanel.length) {
            $existingPanel.replaceWith(html);
        } else {
            this.$element.find('.optimize-container').append(html);
        }

        // Inject instant-actions checkbox into the wrapper (between optimize button and global settings btn)
        // The wrapper may already exist (from gear icon toggle) or may be created here.
        // We always ensure the checkbox is present and up-to-date.
        const instantActionsHtmlInline = this._renderInstantActionsCheckbox('inline');
        // Remove any existing instant-actions row in the wrapper to avoid duplicates
        this.$element.find('.inline-opt-wrapper .instant-actions-checkbox-row').remove();
        if (instantActionsHtmlInline) {
            const $wrapper = this.$element.find('.inline-opt-wrapper');
            if ($wrapper.length) {
                // Wrapper exists — prepend checkbox before the global settings button
                $wrapper.find('.open-global-opt-settings-btn').before($(instantActionsHtmlInline));
                // Wire info icons on the newly injected element
                if (this._instantActionsPopoverHtml) {
                    $wrapper.find('.instant-actions-info-icon').each((_, el) => {
                        el.dataset.infoHtml = this._instantActionsPopoverHtml;
                    });
                    wireInfoIcons($wrapper[0]);
                }
            }
            // If no wrapper yet (will be created by gear icon toggle), it's handled there
        }

        // Initialize slider tracks
        this.$element.find('.inline-opt-settings .weight-slider').each(function () {
            const val = this.value;
            const pct = ((val - this.min) / (this.max - this.min)) * 100;
            this.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
        });

        // Ensure the .inline-opt-wrapper (containing the "Open Global
        // Optimization Settings" button) exists around the panel. This
        // is normally created by the gear icon toggle flow but on a page
        // reload with inlineSettingsOpen=true the panel is built here
        // without the wrapper, so the global button goes missing
        // (bug report item #5, applies to both recipe and activity).
        this._ensureInlineOptWrapper();

        this._attachInlineSettingsEvents();
    }

    /**
     * Ensure the .inline-opt-wrapper exists around .inline-opt-settings
     * with the "Open Global Optimization Settings" button + optional
     * instant-actions checkbox. Idempotent — safe to call whenever the
     * inline panel is rendered. Matches the wrapper built by the gear
     * icon toggle in openOptimizationSettings().
     */
    _ensureInlineOptWrapper() {
        const $panel = this.$element.find('.inline-opt-settings');
        if (!$panel.length) return;
        if ($panel.closest('.inline-opt-wrapper').length) return; // already wrapped

        const $wrapper = $('<div class="inline-opt-wrapper"></div>');
        const $globalBtn = $('<button class="open-global-opt-settings-btn" title="Open the full optimization settings in the Settings modal">Open Global Optimization Settings</button>');
        const instantActionsHtmlInline = this._renderInstantActionsCheckbox('inline');
        const $instantActions = instantActionsHtmlInline ? $(instantActionsHtmlInline) : null;
        $panel.before($wrapper);
        if ($instantActions) $wrapper.append($instantActions);
        $wrapper.append($globalBtn);
        $wrapper.append($panel);

        // Wire info icons on the instant-actions row if we inserted one.
        if ($instantActions && this._instantActionsPopoverHtml) {
            $wrapper.find('.instant-actions-info-icon').each((_, el) => {
                el.dataset.infoHtml = this._instantActionsPopoverHtml;
            });
            wireInfoIcons($wrapper[0]);
        }
    }

    /**
     * Render inline target drop selector (for embedding in sort items)
     */
    _renderInlineTargetDrop(entryTarget, sortIndex) {
        // Use per-entry target, not the global this.targetDrop
        const displayTarget = entryTarget || 'cat:normal_items';
        const targetDisplayName = this._getCategoryDisplayName(displayTarget);
        const targetIcon = this._getCategoryIcon(displayTarget);

        const isFineSelected = displayTarget.includes('fine');
        const iconClass = isFineSelected ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';
        const targetIconHtml = targetIcon
            ? `<img src="${targetIcon}" alt="${targetDisplayName}" class="${iconClass}" />`
            : '';
        const controlId = 'target-drop-' + sortIndex;

        // Skip collectibles checkbox for inline panel
        let skipCollectiblesInline = '';
        if (displayTarget === 'cat:collectibles') {
            const skipEnabled = window.settingsModal?.skipObtainedCollectibles || false;
            const skipChecked = skipEnabled ? 'checked' : '';
            const labelStyle = skipEnabled
                ? 'color:#27ae60;font-style:italic;'
                : 'color:var(--text-muted);';
            skipCollectiblesInline = `
                <label class="optimizer-checkbox" style="margin-top:4px;margin-left:8px;font-size:0.8em;display:flex;align-items:center;gap:5px;">
                    <input type="checkbox" class="skip-obtained-collectibles" ${skipChecked} />
                    <span class="optimizer-checkbox-label" style="${labelStyle}font-weight:600;">Skip collectibles when all obtained</span>
                </label>
            `;
        }

        return `
            <div class="inline-target-control" data-control-id="${controlId}" data-sort-index="${sortIndex}" data-target-type="drop" style="margin-top:6px;">
                <div class="target-label" style="font-size:0.8em;margin-bottom:2px;">Target Drop</div>
                <div class="target-dropdown-button inline-target-btn" style="padding:6px 10px;">
                    <div class="target-dropdown-value" style="gap:6px;">
                        ${targetIconHtml}
                        <span style="font-size:0.9em;">${targetDisplayName}</span>
                    </div>
                    <button class="target-dropdown-toggle">
                        <span class="expand-arrow">▼</span>
                    </button>
                </div>
                ${skipCollectiblesInline}
            </div>
        `;
    }

    /**
     * Render inline target quality selector (for embedding in sort items)
     */
    _renderInlineTargetQuality(entryTarget, sortIndex) {
        const displayQuality = entryTarget || 'Perfect';
        const qualityColors = {
            'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)',
            'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)',
            'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)'
        };
        const qualityBorders = {
            'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)',
            'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)',
            'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)'
        };
        const bgColor = qualityColors[displayQuality] || '';
        const borderColor = qualityBorders[displayQuality] || '';
        const buttonStyles = (bgColor && borderColor)
            ? `background: ${bgColor}; border: 2px solid ${borderColor};`
            : '';
        const controlId = 'target-quality-' + sortIndex;

        return `
            <div class="inline-target-control" data-control-id="${controlId}" data-sort-index="${sortIndex}" data-target-type="quality" style="margin-top:6px;">
                <div class="target-label" style="font-size:0.8em;margin-bottom:2px;">Target Quality</div>
                <div class="target-dropdown-button inline-target-btn" style="padding:6px 10px;${buttonStyles}">
                    <div class="target-dropdown-value" style="gap:6px;">
                        <span style="font-size:0.9em;">${displayQuality}</span>
                    </div>
                    <button class="target-dropdown-toggle">
                        <span class="expand-arrow">▼</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render inline budget inputs (for embedding in sort items)
     */
    _renderInlineBudget() {
        return `
            <div class="inline-target-control" style="margin-top:6px;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <div class="calculator-input-group" style="flex:1;min-width:0;">
                        <label class="calculator-label" style="font-size:0.75em;text-transform:none;letter-spacing:0;">Input Materials</label>
                        <input type="number" class="calculator-input budget-materials-input" value="${this.budgetMaterials || ''}" placeholder="0" min="0" />
                    </div>
                    <div class="calculator-input-group" style="flex:1;min-width:0;">
                        <label class="calculator-label" style="font-size:0.75em;text-transform:none;letter-spacing:0;">Target Output</label>
                        <input type="number" class="calculator-input budget-target-input" value="${this.budgetTarget || ''}" placeholder="0" min="0" />
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Attach events for the inline optimization settings panel
     */
    _attachInlineSettingsEvents() {
        const $panel = this.$element.find('.inline-opt-settings');
        if (!$panel.length) return;

        const settingsModal = window.settingsModal;
        if (!settingsModal) return;

        const isActivity = !!this.selectedActivity;
        const presetType = isActivity ? 'activity' : 'recipe';

        // Weight slider sync.
        //
        // IMPORTANT: selector is scoped to `.sort-item .weight-slider` so
        // these legacy handlers only match the activity-mode sort items.
        // The recipe Detailed panel mounts xy-recipe-priority-list.js which
        // uses `.xy-priority-entry` as its row wrapper and handles weight
        // changes internally (with surgical in-place updates + its own
        // `_skipSettingsRerender=true` save path). Previously this handler
        // used a bare `.weight-slider` selector that ALSO caught XY
        // sliders, silently failed to update (no `.sort-item` ancestor),
        // but still fired a debounced `saveOptimizationSettings()` WITHOUT
        // the skip flag — causing `optimizationSettingsLoaded` to trigger
        // `_renderInlineSettings()` and reset the user's scroll position
        // 300ms after every weight tick.
        $panel.on('input', '.sort-item .weight-slider', (e) => {
            const $slider = $(e.target);
            const val = parseInt($slider.val(), 10);
            $slider.closest('.sort-item').find('.weight-input').val(val);
            // Update slider track
            const pct = ((val - e.target.min) / (e.target.max - e.target.min)) * 100;
            e.target.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
            // Update settings modal data
            const $item = $slider.closest('.sort-item');
            const index = parseInt($item.data('index'), 10);
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            if (index >= 0 && index < sorting.length) {
                sorting[index][1] = val;
            }
            clearTimeout(this._inlineWeightTimer);
            this._inlineWeightTimer = setTimeout(() => settingsModal.saveOptimizationSettings(), 300);
        });

        // Scoped to `.sort-item .weight-input` for the same reason as above —
        // don't fire this handler for XY priority list inputs.
        $panel.on('change', '.sort-item .weight-input', (e) => {
            const $input = $(e.target);
            let val = parseInt($input.val(), 10);
            if (isNaN(val)) val = 100;
            val = Math.max(0, Math.min(100, val));
            $input.val(val);
            const $slider = $input.closest('.sort-item').find('.weight-slider');
            $slider.val(val);
            const pct = ((val - $slider[0].min) / ($slider[0].max - $slider[0].min)) * 100;
            $slider[0].style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
            const $item = $input.closest('.sort-item');
            const index = parseInt($item.data('index'), 10);
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            if (index >= 0 && index < sorting.length) {
                sorting[index][1] = val;
            }
            settingsModal.saveOptimizationSettings();
        });

        // Re-index all sort-items in a list so data-index on the outer
        // .sort-item AND data-sort-index / data-control-id on nested target
        // elements match the current position. Without this, duplicating
        // leaves the clone's inline-target-control pointing at the
        // original's sort index, so changing the copy's target mutates
        // the original entry.
        const reindexInlineSortList = ($list) => {
            $list.children('.sort-item').each((i, el) => {
                const $el = $(el);
                $el.attr('data-index', i);
                $el.data('index', i);
                $el.find('.inline-target-control[data-sort-index]').each((_, inner) => {
                    const $inner = $(inner);
                    $inner.attr('data-sort-index', i);
                    $inner.data('sort-index', i);
                    // Rebuild the control-id so floating dropdowns target
                    // the right control after the swap.
                    const rawId = $inner.attr('data-control-id') || '';
                    const prefixMatch = rawId.match(/^(target-drop-|target-quality-)/);
                    if (prefixMatch) {
                        const newId = prefixMatch[1] + i;
                        $inner.attr('data-control-id', newId);
                        $inner.data('control-id', newId);
                    }
                });
            });
        };

        // Up / down arrow reorder (inline panel, both activity + recipe).
        // For recipe the XY mount handles its own clicks internally, so
        // we check for that and bail before acting. Uses a FLIP-style
        // swap animation via Web Animations API (mirrors
        // xy-recipe-priority-list.js `animateReorderSwap`) so only the
        // two affected rows visibly move — no full re-render, no scroll
        // reset.
        $panel.on('click', '.xy-move-up, .xy-move-down', (e) => {
            const $btn = $(e.currentTarget);
            if ($btn.closest('.xy-recipe-inline-mount').length) return;
            if ($btn.prop('disabled')) return;
            e.preventDefault();
            e.stopPropagation();

            const isUp = $btn.hasClass('xy-move-up');
            const index = parseInt($btn.data('index'), 10);
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;

            const targetIdx = isUp ? index - 1 : index + 1;
            if (targetIdx < 0 || targetIdx >= sorting.length) return;

            const $list = $btn.closest('.sort-list');
            const $rows = $list.children('.sort-item');
            const $moved = $rows.eq(index);
            const $neighbor = $rows.eq(targetIdx);

            // Fallback to full re-render if DOM doesn't match expected
            // layout (should never happen, but keep as safety net).
            if (!$moved.length || !$neighbor.length) {
                const [mv] = sorting.splice(index, 1);
                sorting.splice(targetIdx, 0, mv);
                settingsModal._clearPresetSelection(isActivity ? 'activity' : 'recipe');
                settingsModal.saveOptimizationSettings();
                this._renderInlineSettings();
                return;
            }

            // FLIP — capture before-rects.
            const beforeMoved = $moved[0].getBoundingClientRect();
            const beforeNeighbor = $neighbor[0].getBoundingClientRect();

            // Data swap.
            const [movedEntry] = sorting.splice(index, 1);
            sorting.splice(targetIdx, 0, movedEntry);

            // DOM swap (only the two rows — everything else stays put).
            if (isUp) $moved.insertBefore($neighbor);
            else $moved.insertAfter($neighbor);

            // FLIP — capture after-rects and animate.
            const afterMoved = $moved[0].getBoundingClientRect();
            const afterNeighbor = $neighbor[0].getBoundingClientRect();
            const dyMoved = beforeMoved.top - afterMoved.top;
            const dyNeighbor = beforeNeighbor.top - afterNeighbor.top;
            const duration = 280;
            const easing = 'ease';
            if (dyMoved !== 0) {
                $moved[0].animate([
                    { transform: `translateY(${dyMoved}px)` },
                    { transform: 'translateY(0)' }
                ], { duration, easing });
            }
            if (dyNeighbor !== 0) {
                $neighbor[0].animate([
                    { transform: `translateY(${dyNeighbor}px)` },
                    { transform: 'translateY(0)' }
                ], { duration, easing });
            }

            // Reindex data-index on .sort-item (+ nested target controls
            // via data-sort-index + data-control-id) and refresh the
            // up/down button data-index + boundary disabled states.
            reindexInlineSortList($list);
            const $allRows = $list.children('.sort-item');
            const total = $allRows.length;
            $allRows.each(function (i) {
                const $row = $(this);
                $row.find('.xy-move-up').attr('data-index', i).data('index', i).prop('disabled', i <= 0);
                $row.find('.xy-move-down').attr('data-index', i).data('index', i).prop('disabled', i >= total - 1);
            });

            // Suppress the `optimizationSettingsLoaded` listener that
            // would otherwise kick off a full _renderInlineSettings()
            // right after saveOptimizationSettings() resolves.
            this._skipSettingsRerender = true;
            settingsModal._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            const done = settingsModal.saveOptimizationSettings();
            const clearFlag = () => { this._skipSettingsRerender = false; };
            if (done && typeof done.finally === 'function') done.finally(clearFlag);
            else setTimeout(clearFlag, 400);

            // Scroll follow — keep the moved row in view if it drifted
            // past the edge of the scroll container.
            setTimeout(() => {
                try {
                    const el = $moved[0];
                    if (el && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                } catch (_err) { /* noop */ }
            }, 300);
        });

        // Remove button — slide up and remove from DOM (no re-render)
        $panel.on('click', '.sort-remove-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            if ($btn.prop('disabled')) return;
            const $item = $btn.closest('.sort-item');
            const index = parseInt($item.data('index'), 10);
            const $list = $item.closest('.sort-list');
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;

            // Don't allow removing last item
            if (sorting.length <= 1) return;

            this._skipSettingsRerender = true;
            $item.css('pointer-events', 'none');
            $item.slideUp(250, () => {
                $item.remove();
                sorting.splice(index, 1);
                reindexInlineSortList($list);
                settingsModal.saveOptimizationSettings();
                setTimeout(() => { this._skipSettingsRerender = false; }, 400);
            });
        });

        // Duplicate button — clone, insert hidden, slide down (no re-render)
        $panel.on('click', '.sort-duplicate-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $item = $(e.currentTarget).closest('.sort-item');
            const key = $item.data('key');
            const index = parseInt($item.data('index'), 10);
            // Prefer live input value over data-weight (which can be stale).
            // Use isNaN check instead of `|| 100` so 0 is preserved.
            const $input = $item.find('.weight-input');
            let weight = parseInt($input.val(), 10);
            if (isNaN(weight)) {
                weight = parseInt($item.data('weight'), 10);
                if (isNaN(weight)) weight = 100;
            }
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            const existingTarget = sorting[index] ? sorting[index][2] || null : null;
            sorting.splice(index + 1, 0, [key, weight, existingTarget]);

            this._skipSettingsRerender = true;
            // Clone the item, set hidden, insert after, slide down
            const $clone = $item.clone();
            $clone.css('display', 'none');
            $item.after($clone);
            // Re-index the whole list so the clone AND subsequent items
            // have correct data-index, data-sort-index, and data-control-id.
            // Without this, the clone's inline-target-control still points
            // at the original's sort index, so editing the copy's target
            // changes the original.
            const $list = $item.closest('.sort-list');
            reindexInlineSortList($list);
            $clone.slideDown(250, () => {
                settingsModal.saveOptimizationSettings();
                setTimeout(() => { this._skipSettingsRerender = false; }, 400);
            });
        });

        // Add button
        $panel.on('click', '.sort-add-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $wrapper = $(e.currentTarget).closest('.sort-add-wrapper');
            const $dropdown = $wrapper.find('.sort-add-dropdown');
            $dropdown.val('');
            $dropdown.toggle();
        });

        // Add dropdown selection
        $panel.on('change', '.sort-add-dropdown', (e) => {
            const key = $(e.target).val();
            if (!key) return;
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            sorting.push([key, 100, null]);
            $(e.target).hide();
            settingsModal.saveOptimizationSettings();
            this._renderInlineSettings();
            this.$element.find('.inline-opt-settings').show();
        });

        // Reset to default
        $panel.on('click', '.sort-reset-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isActivity) {
                // Activity uses the X-per-Y dict shape now (mirror of recipe).
                // Fresh defaults come from the shared helper. Propagate to
                // every mounted activity controller (Settings modal Detailed,
                // Column 3 Quick, Column 3 inline Detailed) so the panel
                // updates immediately without waiting for a re-render.
                settingsModal.activitySorting = defaultActivityEntries();
                try { settingsModal._propagateActivitySortingToMounts(); } catch (e2) { /* noop */ }
            } else {
                // Recipe: fresh defaults, then push into EVERY mounted
                // controller so whichever panel the user is currently
                // viewing (Quick, inline Detailed, Settings modal Detailed)
                // updates immediately. Without notifying all three, a user
                // who clicks reset from the inline panel sees no change
                // until they close and reopen the gear icon.
                settingsModal.recipeSorting = defaultRecipeEntries();
                try { settingsModal._propagateRecipeSortingToMounts(); } catch (e2) { /* noop */ }
            }
            settingsModal.saveOptimizationSettings();
            this._renderInlineSettings();
            this.$element.find('.inline-opt-settings').show();
        });

        // Inline target drop/quality button click — open the dropdown
        $panel.on('click', '.inline-target-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $control = $btn.closest('.inline-target-control');
            const controlId = $control.data('control-id');
            const $arrow = $btn.find('.expand-arrow');

            // Close any other open floating dropdowns
            $panel.find('.inline-floating-dropdown').not(`[data-for="${controlId}"]`).slideUp(200).remove();
            $panel.find('.inline-target-btn .expand-arrow.expanded').not($arrow).removeClass('expanded');

            // Check if dropdown already exists for this control
            let $dropdown = $panel.find(`.inline-floating-dropdown[data-for="${controlId}"]`);

            if ($dropdown.length && $dropdown.is(':visible')) {
                $arrow.removeClass('expanded');
                $dropdown.slideUp(200, () => $dropdown.remove());
            } else {
                // Remove any existing dropdown for this control
                $dropdown.remove();

                // Calculate position relative to the panel
                const btnRect = $btn[0].getBoundingClientRect();
                const panelRect = $panel[0].getBoundingClientRect();
                const topOffset = btnRect.bottom - panelRect.top;
                const leftOffset = btnRect.left - panelRect.left;
                const width = btnRect.width;

                // Create floating dropdown appended to the panel (not inside sort-list)
                const dropdownHtml = `<div class="inline-floating-dropdown target-dropdown" data-for="${controlId}" style="display:none;position:absolute;top:${topOffset}px;left:${leftOffset}px;width:${width}px;z-index:3000;">${this.renderTargetDropdownContent()}</div>`;
                $panel.append(dropdownHtml);
                $dropdown = $panel.find(`.inline-floating-dropdown[data-for="${controlId}"]`);
                wireInfoIcons($dropdown[0]);
                $arrow.addClass('expanded');
                $dropdown.slideDown(200);
            }
        });

        // Inline target item selection (from floating dropdown)
        $panel.on('click', '.inline-floating-dropdown .target-item', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const value = $(e.currentTarget).data('value');
            const $dropdown = $(e.currentTarget).closest('.inline-floating-dropdown');
            const controlId = $dropdown.data('for');

            // Find the control that opened this dropdown to get the sort index
            const $control = $panel.find(`.inline-target-control[data-control-id="${controlId}"]`);
            const sortIndex = parseInt($control.data('sort-index'), 10);

            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            if (sortIndex >= 0 && sortIndex < sorting.length) {
                // Update the target on this specific entry
                sorting[sortIndex][2] = value;
                settingsModal.saveOptimizationSettings();
            }

            // Slide up the floating dropdown, then re-render
            $panel.find('.inline-target-btn .expand-arrow.expanded').removeClass('expanded');
            $dropdown.slideUp(200, () => {
                $panel.find('.inline-floating-dropdown').remove();
                const scrollTop = this.$element.find('.inline-sort-list').scrollTop();
                this._renderInlineSettings();
                this.$element.find('.inline-opt-settings').show();
                this.$element.find('.inline-sort-list').scrollTop(scrollTop);
            });
        });

        // Click outside floating dropdown to close it
        $(document).on('click.inline-dropdown', (e) => {
            if (!$(e.target).closest('.inline-floating-dropdown, .inline-target-btn').length) {
                const $openDropdowns = $panel.find('.inline-floating-dropdown');
                if ($openDropdowns.length) {
                    $panel.find('.inline-target-btn .expand-arrow.expanded').removeClass('expanded');
                    $openDropdowns.slideUp(200, function () { $(this).remove(); });
                }
            }
        });

        // Budget inputs
        $panel.on('change', '.budget-materials-input', (e) => {
            this.budgetMaterials = parseInt(e.target.value) || 0;
        });
        $panel.on('change', '.budget-target-input', (e) => {
            this.budgetTarget = parseInt(e.target.value) || 0;
        });

        // Skip obtained collectibles checkbox (inline panel)
        $panel.on('change', '.skip-obtained-collectibles', (e) => {
            if (window.settingsModal) {
                window.settingsModal.skipObtainedCollectibles = e.target.checked;
                localStorage.setItem('skipObtainedCollectibles', e.target.checked.toString());
                window.settingsModal.saveOptimizationSettings();
            }
            const $label = $(e.target).closest('label').find('.optimizer-checkbox-label');
            if (e.target.checked) {
                $label.css({ color: '#27ae60', fontStyle: 'italic' });
            } else {
                $label.css({ color: 'var(--text-muted)', fontStyle: 'normal' });
            }
        });

        // Target drop rate input
        $panel.on('input', '.target-rate-input', (e) => {
            this.targetDropRate = parseFloat(e.target.value) || 0;
            store.update('ui.column3.targetDropRate', this.targetDropRate);
        });

        // Drag and drop for inline sort list
        this._attachInlineDragAndDrop($panel.find('.inline-sort-list'));

        // Preset events — delegate to settings modal
        $panel.on('click', '.preset-save-btn', (e) => {
            e.preventDefault();
            settingsModal.savePreset(presetType);
        });

        $panel.on('input', '.preset-name-input', (e) => {
            const name = $(e.target).val();
            if (presetType === 'activity') {
                settingsModal._activityPresetName = name;
            } else {
                settingsModal._recipePresetName = name;
            }
            const hasName = name.trim().length > 0;
            $(e.target).closest('.preset-bar').find('.preset-save-btn').prop('disabled', !hasName);
        });

        $panel.on('click', '.preset-dropdown-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $bar = $(e.currentTarget).closest('.preset-bar');
            const $dropdown = $bar.find('.gear-set-dropdown');
            const $arrow = $(e.currentTarget).find('.expand-arrow');
            const isOpen = $dropdown.is(':visible');

            if (!isOpen) {
                const presets = presetType === 'activity' ? settingsModal.activityPresets : settingsModal.recipePresets;
                const presetItems = presets.map(p => `
                    <div class="gear-set-item preset-item-entry" data-id="${p.id}" data-preset-type="${presetType}">
                        <span class="gear-set-name">${p.name}</span>
                        <button class="delete-button preset-item-delete" data-id="${p.id}" data-preset-type="${presetType}">×</button>
                    </div>
                `).join('');
                $dropdown.html(`
                    <div class="gear-set-list">
                        <div class="gear-set-item new-gear-set preset-new-item" data-preset-type="${presetType}">
                            <span class="gear-set-name">+ New Preset</span>
                        </div>
                        ${presetItems}
                    </div>
                `);
                $arrow.addClass('expanded');
                $dropdown.slideDown(200);
            } else {
                $arrow.removeClass('expanded');
                $dropdown.slideUp(200);
            }
        });

        $panel.on('click', '.preset-item-entry', (e) => {
            if ($(e.target).hasClass('preset-item-delete') || $(e.target).hasClass('delete-button')) return;
            const presetId = $(e.currentTarget).data('id');
            settingsModal.loadPreset(presetType, presetId).then(() => {
                this._renderInlineSettings();
                this.$element.find('.inline-opt-settings').show();
            });
            const $bar = $(e.currentTarget).closest('.preset-bar');
            $bar.find('.gear-set-dropdown').slideUp(200);
            $bar.find('.expand-arrow').removeClass('expanded');
        });

        $panel.on('click', '.preset-new-item', (e) => {
            if (presetType === 'activity') {
                settingsModal.selectedActivityPresetId = null;
                settingsModal._activityPresetName = '';
            } else {
                settingsModal.selectedRecipePresetId = null;
                settingsModal._recipePresetName = '';
            }
            this._renderInlineSettings();
            this.$element.find('.inline-opt-settings').show();
            this.$element.find('.inline-opt-settings .preset-name-input').focus();
        });

        $panel.on('click', '.preset-item-delete', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetId = $(e.currentTarget).data('id');
            settingsModal.deletePreset(presetType, presetId).then(() => {
                this._renderInlineSettings();
                this.$element.find('.inline-opt-settings').show();
            });
        });

        $panel.on('click', '.preset-export-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const encoded = settingsModal.encodePreset(presetType);
            const $input = $panel.find('.preset-import-input');
            $input.show().val(encoded).select();
            try {
                document.execCommand('copy');
                const $btn = $(e.currentTarget);
                const original = $btn.text();
                $btn.text('Copied!');
                setTimeout(() => $btn.text(original), 1500);
            } catch (err) { /* input shown for manual copy */ }
        });

        $panel.on('click', '.preset-import-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $input = $panel.find('.preset-import-input');
            $input.toggle().val('').focus();
        });

        $panel.on('keydown', '.preset-import-input', (e) => {
            if (e.key === 'Enter') {
                const encoded = $(e.target).val();
                if (encoded.trim()) {
                    settingsModal.decodeAndApplyPreset(presetType, encoded);
                    this._renderInlineSettings();
                    this.$element.find('.inline-opt-settings').show();
                }
            } else if (e.key === 'Escape') {
                $(e.target).hide().val('');
            }
        });
    }

    /**
     * Attach drag and drop for inline sort list
     */
    _attachInlineDragAndDrop($list) {
        if (!$list.length) return;
        const settingsModal = window.settingsModal;
        const isActivity = !!this.selectedActivity;
        let draggedElement = null;

        $list.find('.sort-item').each(function () {
            $(this).attr('draggable', 'true');
        });

        $list.on('mousedown', '.weight-slider, .weight-input, .sort-remove-btn, .sort-duplicate-btn', (e) => {
            const $item = $(e.target).closest('.sort-item');
            $item.attr('draggable', 'false');
            $(document).one('mouseup', () => $item.attr('draggable', 'true'));
        });

        $list.on('dragstart', '.sort-item', (e) => {
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'button') { e.preventDefault(); return; }
            draggedElement = e.currentTarget;
            $(draggedElement).addClass('dragging');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
        });

        $list.on('dragend', '.sort-item', () => {
            if (draggedElement) $(draggedElement).removeClass('dragging');
            draggedElement = null;
        });

        $list.on('dragover', '.sort-item', (e) => {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'move';
            const $target = $(e.currentTarget);
            if ($target[0] === draggedElement) return;
            const rect = $target[0].getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.originalEvent.clientY < midpoint) {
                $target.before($(draggedElement));
            } else {
                $target.after($(draggedElement));
            }
        });

        $list.on('drop', '.sort-item', (e) => {
            e.preventDefault();
            const newOrder = [];
            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                // Read weight from the actual input (data-weight attr isn't updated
                // when slider changes, which would cause weights to snap to 100 on reorder)
                const $input = $(this).find('.weight-input');
                let weight = parseInt($input.val(), 10);
                if (isNaN(weight)) {
                    weight = parseInt($(this).data('weight'), 10);
                    if (isNaN(weight)) weight = 100;
                }
                weight = Math.max(0, Math.min(100, weight));
                const target = $(this).data('target') || null;
                $(this).data('index', index);
                $(this).attr('data-index', index);
                $(this).attr('data-weight', weight);
                // Keep nested inline-target-control indices in sync so target
                // clicks on a reordered row update the right entry.
                $(this).find('.inline-target-control[data-sort-index]').each(function () {
                    $(this).attr('data-sort-index', index);
                    $(this).data('sort-index', index);
                    const rawId = $(this).attr('data-control-id') || '';
                    const prefixMatch = rawId.match(/^(target-drop-|target-quality-)/);
                    if (prefixMatch) {
                        const newId = prefixMatch[1] + index;
                        $(this).attr('data-control-id', newId);
                        $(this).data('control-id', newId);
                    }
                });
                newOrder.push([key, weight, target]);
            });
            if (isActivity) {
                settingsModal.activitySorting = newOrder;
            } else {
                settingsModal.recipeSorting = newOrder;
            }
            settingsModal.saveOptimizationSettings();
        });

        // Touch events
        $list.on('touchstart', '.drag-handle', (e) => {
            const $item = $(e.currentTarget).closest('.sort-item');
            draggedElement = $item[0];
            setTimeout(() => { if (draggedElement) $(draggedElement).addClass('dragging'); }, 100);
        });

        $list.on('touchmove', (e) => {
            if (!draggedElement) return;
            e.preventDefault();
            const touchY = e.originalEvent.touches[0].clientY;
            const elements = $list.find('.sort-item').not('.dragging');
            elements.each(function () {
                const rect = this.getBoundingClientRect();
                if (touchY >= rect.top && touchY <= rect.bottom) {
                    const midpoint = rect.top + rect.height / 2;
                    if (touchY < midpoint) $(this).before($(draggedElement));
                    else $(this).after($(draggedElement));
                    return false;
                }
            });
        });

        $list.on('touchend touchcancel', () => {
            if (!draggedElement) return;
            $(draggedElement).removeClass('dragging');
            const newOrder = [];
            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                const $input = $(this).find('.weight-input');
                let weight = parseInt($input.val(), 10);
                if (isNaN(weight)) {
                    weight = parseInt($(this).data('weight'), 10);
                    if (isNaN(weight)) weight = 100;
                }
                weight = Math.max(0, Math.min(100, weight));
                const target = $(this).data('target') || null;
                $(this).data('index', index);
                $(this).attr('data-index', index);
                $(this).attr('data-weight', weight);
                // Keep nested inline-target-control indices in sync so target
                // clicks on a reordered row update the right entry.
                $(this).find('.inline-target-control[data-sort-index]').each(function () {
                    $(this).attr('data-sort-index', index);
                    $(this).data('sort-index', index);
                    const rawId = $(this).attr('data-control-id') || '';
                    const prefixMatch = rawId.match(/^(target-drop-|target-quality-)/);
                    if (prefixMatch) {
                        const newId = prefixMatch[1] + index;
                        $(this).attr('data-control-id', newId);
                        $(this).data('control-id', newId);
                    }
                });
                newOrder.push([key, weight, target]);
            });
            if (isActivity) {
                settingsModal.activitySorting = newOrder;
            } else {
                settingsModal.recipeSorting = newOrder;
            }
            settingsModal.saveOptimizationSettings();
            draggedElement = null;
        });
    }

    /**
     * Toggle target dropdown
     */
    toggleTargetDropdown() {
        this.isTargetDropdownOpen = !this.isTargetDropdownOpen;

        const $dropdown = this.$element.find('.target-dropdown');
        const $arrow = this.$element.find('.target-dropdown-toggle .expand-arrow');

        if (this.isTargetDropdownOpen) {
            // Render dropdown content
            $dropdown.html(this.renderTargetDropdownContent());
            wireInfoIcons($dropdown[0]);

            // Update arrow and slide down
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);
        } else {
            // Update arrow and slide up
            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
        }
    }

    /**
     * Select target drop (for activities)
     */
    selectTargetDrop(itemName) {
        this.targetDrop = itemName;
        this.isTargetDropdownOpen = false;
        // Persist to session
        store.update('ui.column3.targetDrop', this.targetDrop);
        this.render();
    }

    /**
     * Select target quality (for recipes)
     */
    selectTargetQuality(quality) {
        this.targetQuality = quality;
        this.isTargetDropdownOpen = false;
        this.render();
    }

    /**
     * Run optimization
     */
    async optimize(targetSlot = null, overrideLocks = null, overrideOptions = {}) {
        if (this.isOptimizing) {
            return;
        }

        this.isOptimizing = true;
        // One-time nudge if this device benchmarked faster than the server.
        // Blocks (awaits) until the user picks local vs server, applying the
        // choice before the optimize proceeds. No-op once chosen / if ineligible.
        try { await maybeShowLocalSpeedWarning(); } catch (_) { /* non-fatal */ }
        this._optimizingSlot = targetSlot; // Track which slot we're optimizing for
        this._suppressResultUI = overrideOptions.suppressResultUI || false; // Suppress equip button + toast when triggered from popup
        this._findAlternativesOnly = overrideOptions.findOnly || false; // Discovery-only: compute alternatives, never equip
        this._wasCancelled = false; // Reset cancel flag for this run

        // Flush all pending debounced saves to ensure backend has latest state
        try {
            await store.flushPendingSaves();
        } catch (e) {
            console.warn('[Optimize] Failed to flush pending saves:', e);
        }

        // Prevent _loadGearSets from copying current→gearset2 during optimization
        store._skipGearset2Copy = true;

        // Slide up equip button if visible, then re-render
        const $equipBtn = this.$element.find('.equip-gearset-btn');
        if ($equipBtn.length && this.showEquipButton) {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
            $equipBtn.slideUp(300, () => {
                this.optimizationStartTime = new Date().toISOString();
                this.render();
            });
        } else {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
            this.optimizationStartTime = new Date().toISOString();
            this.render();
        }

        try {
            // Determine optimization type and ID
            const optType = this.selectedActivity ? 'activity' : 'recipe';
            const optId = this.selectedActivity || this.selectedRecipe;

            console.log(`Starting optimization for ${optType}: ${optId}`);

            // Get sorting priorities from session
            const sortingPriority = await this.getSortingPriorities(optType);
            console.log('[OptDebug] sending sorting_priority to backend:',
                JSON.stringify(sortingPriority).slice(0, 1200),
                `(${Array.isArray(sortingPriority) ? sortingPriority.length : '?'} entries)`);

            // Build request data
            const requestData = {
                type: optType,
                id: optId,
                sorting_priority: sortingPriority
            };

            // Client-side (Pyodide) optimization: only when the FAC is on AND
            // the user enabled the settings toggle. The server returns the
            // request_data instead of starting a server job (see below).
            requestData.run_local = !!(
                window._featureFlags && window._featureFlags.local_optimization &&
                window.settingsModal && window.settingsModal.runLocalOptimization
            );

            // In comparison mode, tell the backend which gearset slot we're optimizing
            if (targetSlot) {
                requestData.target_slot = targetSlot;
            }

            // Debug: log current state
            console.log('Current store.state.column3:', store.state.column3);

            // Get include_consumables from settings
            let includeConsumables = window.settingsModal?.includeConsumables || false;
            requestData.include_consumables = includeConsumables;
            console.log('includeConsumables:', includeConsumables);

            // Get include_pets from settings
            requestData.include_pets = window.settingsModal?.includePets || false;

            // Non-owned alternatives are always enabled for everyone
            requestData.show_non_owned_alternatives = true;

            // Add selected input items (e.g., arrows for hunting activities)
            // In comparison mode, use the target gearset's input items
            let selectedInputItems = store.state.column3?.selectedInputItems;
            let useFineInputs = store.state.column3?.useFineInputs || false;
            if (targetSlot) {
                const ctxKey = targetSlot === 1 ? 'gs1Context' : 'gs2Context';
                const gsCtx = store.state.gearsets?.[ctxKey] || {};
                console.log(`[Optimize] targetSlot=${targetSlot}, gsCtx.selectedInputItems:`, gsCtx.selectedInputItems);
                if (gsCtx.selectedInputItems && Object.keys(gsCtx.selectedInputItems).length > 0) {
                    selectedInputItems = gsCtx.selectedInputItems;
                }
                useFineInputs = gsCtx.useFine || false;
            }

            // Auto-select input items if the activity requires them but user hasn't picked any
            if (optType === 'activity') {
                const activitySection = window.activityInfoSection;
                const activity = activitySection?.activity;
                if (activity && activity.input_items && activity.input_items.length > 0) {
                    const validInputItems = activity.input_items.filter(ii => ii && ii.name);
                    const hasKeywordInputs = validInputItems.some(ii => ii.type === 'keyword');
                    if (hasKeywordInputs) {
                        if (!selectedInputItems) selectedInputItems = {};
                        let autoSelected = false;
                        try {
                            const catalog = await api.getCatalog();
                            // Use original validInputItems index (matches _selectedInputItems indexing)
                            for (let idx = 0; idx < validInputItems.length; idx++) {
                                const ii = validInputItems[idx];
                                if (ii.type !== 'keyword') continue; // Only auto-select keyword slots
                                if (selectedInputItems[idx]) continue; // Already filled
                                const kw = (ii.reference || ii.name || '').toLowerCase().replace(/_/g, ' ');
                                const minLevel = ii.level || 0;

                                // Find owned items matching this keyword
                                const candidates = (catalog.items || []).filter(item => {
                                    if (!item.keywords || !item.keywords.some(k => k.toLowerCase().replace(/_/g, ' ') === kw)) return false;
                                    // Check level requirement
                                    if (minLevel > 0) {
                                        const reqs = item.requirements || [];
                                        const skillReq = reqs.find(r => r.type === 'skill');
                                        if (skillReq && (skillReq.level || 0) < minLevel) return false;
                                    }
                                    // Check ownership
                                    const overrides = store.state.ui?.user_overrides || {};
                                    const overrideState = (overrides.items && overrides.items[item.id]) || {};
                                    const baseState = store.state.items[item.id] || {};
                                    const has = overrideState.has !== undefined ? overrideState.has : baseState.has;
                                    return has === true;
                                });

                                if (candidates.length > 0) {
                                    // Pick the best candidate: prefer crafted items with highest quality,
                                    // then items with the most stats for the activity's skill
                                    const actSkill = (activity.primary_skill || '').toLowerCase();
                                    const scored = candidates.map(item => {
                                        let stats = item.stats || {};
                                        // For crafted items, use the owned quality's stats
                                        if (item.type === 'crafted_item' && item.stats_by_quality) {
                                            const baseState = store.state.items[item.id] || {};
                                            const overrides = store.state.ui?.user_overrides || {};
                                            const overrideState = (overrides.items && overrides.items[item.id]) || {};
                                            const quality = overrideState.quality || baseState.quality || 'Normal';
                                            stats = item.stats_by_quality[quality] || stats;
                                        }
                                        // Score: sum of all stat values for the activity's skill
                                        let score = 0;
                                        for (const [skill, locs] of Object.entries(stats)) {
                                            if (skill === actSkill || skill === 'global') {
                                                for (const statVals of Object.values(locs || {})) {
                                                    for (const v of Object.values(statVals || {})) {
                                                        score += Math.abs(Number(v) || 0);
                                                    }
                                                }
                                            }
                                        }
                                        return { item, stats, score };
                                    });
                                    scored.sort((a, b) => b.score - a.score);
                                    const best = scored[0];

                                    // Build slotItem matching the format from item-selection-popup
                                    let rarity = best.item.rarity || 'common';
                                    let quality = null;
                                    let itemStats = best.stats;
                                    if (best.item.type === 'crafted_item') {
                                        const baseState = store.state.items[best.item.id] || {};
                                        const overrides = store.state.ui?.user_overrides || {};
                                        const overrideState = (overrides.items && overrides.items[best.item.id]) || {};
                                        quality = overrideState.quality || baseState.quality || 'Normal';
                                        const qualityToRarity = {
                                            'Eternal': 'ethereal', 'Perfect': 'legendary', 'Excellent': 'epic',
                                            'Great': 'rare', 'Good': 'uncommon', 'Normal': 'common'
                                        };
                                        rarity = qualityToRarity[quality] || 'common';
                                        if (best.item.stats_by_quality) {
                                            itemStats = best.item.stats_by_quality[quality] || itemStats;
                                        }
                                    }

                                    const slotItem = {
                                        itemId: best.item.id,
                                        uuid: best.item.uuid,
                                        name: best.item.name,
                                        icon_path: best.item.icon_path,
                                        rarity: rarity,
                                        quality: quality,
                                        keywords: best.item.keywords || [],
                                        is_fine: false,
                                        is_generic: best.item.is_generic || false,
                                        icon: best.item.icon || null,
                                        icon_color: best.item.icon_color || null,
                                        stats: itemStats,
                                    };

                                    selectedInputItems[idx] = slotItem;
                                    autoSelected = true;
                                    console.log(`[Optimize] Auto-selected input item for slot ${idx}: ${best.item.name} (score: ${best.score})`);
                                }
                            }
                        } catch (e) {
                            console.warn('[Optimize] Failed to auto-select input items:', e);
                        }

                        // If we auto-selected, update the UI so the user sees it
                        if (autoSelected) {
                            if (activitySection) {
                                for (const [idx, item] of Object.entries(selectedInputItems)) {
                                    if (item && !activitySection._selectedInputItems[idx]) {
                                        activitySection._selectedInputItems[idx] = item;
                                    }
                                }
                                activitySection.render();
                            }
                            // Persist to store
                            if (!store.state.column3) store.state.column3 = {};
                            store.state.column3.selectedInputItems = { ...selectedInputItems };
                            store._saveColumn3Selection();

                            // Update combined stats section with the new input items
                            const css = window.combinedStatsSection;
                            if (css) {
                                for (const [idx, item] of Object.entries(selectedInputItems)) {
                                    if (item && item.stats) {
                                        css._inputItems[parseInt(idx)] = item;
                                    }
                                }
                            }

                            api.showInfo('Auto-selected input items for optimization');
                        }
                    }
                }
            }

            if (selectedInputItems && Object.keys(selectedInputItems).length > 0) {
                // Send just the item IDs and names (not full objects)
                const inputItemsForRequest = {};
                for (const [idx, item] of Object.entries(selectedInputItems)) {
                    if (item) {
                        inputItemsForRequest[idx] = {
                            id: item.itemId || item.id || null,
                            name: item.name || null,
                            export_name: item.export_name || null,
                        };
                    }
                }
                requestData.input_items = inputItemsForRequest;
                requestData.use_fine_inputs = useFineInputs;
                console.log('Input items for optimization:', inputItemsForRequest, 'useFine:', useFineInputs);
            }

            // Add user-selected location (for multi-location activities)
            // In comparison mode, use the target slot's location context
            let selectedLocation = store.state.column3?.selectedLocation;
            if (targetSlot === 1) {
                selectedLocation = store.state.gearsets?.gs1Context?.selectedLocation || selectedLocation;
            } else if (targetSlot === 2) {
                selectedLocation = store.state.gearsets?.gs2Context?.selectedLocation || selectedLocation;
            }
            if (selectedLocation) {
                requestData.location = selectedLocation;
                console.log('selectedLocation:', selectedLocation);
            }

            // Build locked slots: merge per-slot locks with global locks
            // In comparison mode, use the target slot's gearset and locks
            const currentGear = (targetSlot === 2)
                ? (store.state.gearsets?.gearset2 || {})
                : (store.state.gearsets?.current || {});
            const perSlotLocks = overrideLocks !== null ? overrideLocks
                : (targetSlot === 2)
                    ? (store.state.gearsets?.gearset2LockedSlots || {})
                    : (targetSlot === 1)
                        ? (store.state.gearsets?.lockedSlots || {})
                        : store.getActiveLockedSlots();
            const lockedSlots = {};

            // Add per-slot locks first (take precedence)
            // Lock objects may contain snapshotted {itemId, quality, level} from lock time,
            // or legacy boolean `true` values that need item lookup from currentGear.
            for (const slotName of Object.keys(perSlotLocks)) {
                const lockValue = perSlotLocks[slotName];
                if (lockValue && typeof lockValue === 'object' && lockValue.itemId) {
                    // New format: use snapshotted item data directly
                    const lockData = {
                        itemId: lockValue.itemId,
                        quality: lockValue.quality || null
                    };
                    if (lockValue.level !== undefined) lockData.level = lockValue.level;
                    lockedSlots[slotName] = lockData;
                } else {
                    // Legacy boolean format: look up from currentGear
                    const item = currentGear[slotName];
                    if (item && item.itemId) {
                        const lockData = {
                            itemId: item.itemId,
                            quality: item.quality || null
                        };
                        if (item.level !== undefined) lockData.level = item.level;
                        lockedSlots[slotName] = lockData;
                    }
                }
            }

            // Merge global locks (if enabled) for remaining slots
            if (window.settingsModal?.lockCurrentGearSlots) {
                for (const [slot, item] of Object.entries(currentGear)) {
                    if (item && item.itemId && !lockedSlots[slot]) {
                        // Skip consumable/pet if not included in optimization
                        if (slot === 'consumable' && !includeConsumables) continue;
                        if (slot === 'pet' && !requestData.include_pets) continue;
                        const lockData = {
                            itemId: item.itemId,
                            quality: item.quality || null
                        };
                        if (item.level !== undefined) lockData.level = item.level;
                        lockedSlots[slot] = lockData;
                    }
                }
            }

            if (Object.keys(lockedSlots).length > 0) {
                requestData.locked_slots = lockedSlots;
                console.log('Locked slots:', lockedSlots);
            }

            // Send equipped consumable/pet from the target gearset directly
            // (avoids stale database reads due to save debounce)
            const equippedConsumable = currentGear.consumable;
            const equippedPet = currentGear.pet;
            console.log(`[Optimize] targetSlot=${targetSlot}, currentGear consumable:`, equippedConsumable, 'pet:', equippedPet);
            console.log(`[Optimize] GS1 consumable:`, store.state.gearsets?.current?.consumable, 'GS2 consumable:', store.state.gearsets?.gearset2?.consumable);
            console.log(`[Optimize] GS1 pet:`, store.state.gearsets?.current?.pet, 'GS2 pet:', store.state.gearsets?.gearset2?.pet);
            if (equippedConsumable && equippedConsumable.itemId) {
                requestData.equipped_consumable = {
                    itemId: equippedConsumable.itemId,
                    name: equippedConsumable.name,
                    is_fine: equippedConsumable.is_fine || false,
                    quality: equippedConsumable.quality || null
                };
                console.log('[Optimize] Sending equipped_consumable:', requestData.equipped_consumable);
            } else {
                console.log('[Optimize] No consumable equipped in target gearset');
            }
            if (equippedPet && equippedPet.itemId) {
                requestData.equipped_pet = {
                    itemId: equippedPet.itemId,
                    name: equippedPet.name,
                    level: equippedPet.level,
                    variant: equippedPet.variant || 'normal',
                    useAbility: equippedPet.useAbility || false,
                };
                console.log('[Optimize] Sending equipped_pet:', requestData.equipped_pet);
            } else {
                console.log('[Optimize] No pet equipped in target gearset');
            }

            // Add target item or quality
            if (optType === 'activity' && this.targetDrop !== 'raw_rewards') {
                requestData.target_item = this.targetDrop;
                // For fine_item/collectible, include the user-provided base drop rate
                if (this.targetDrop === 'fine_item' || this.targetDrop === 'collectible') {
                    // Read directly from DOM as safety net
                    const $rateInput = this.$element.find('.target-rate-input');
                    if ($rateInput.length) {
                        this.targetDropRate = parseFloat($rateInput.val()) || 0;
                    }
                    if (this.targetDropRate > 0) {
                        requestData.target_drop_rate = this.targetDropRate;
                    }
                }
            } else if (optType === 'recipe') {
                requestData.target_quality = this.targetQuality;

                // Get selected service — use per-gearset context in comparison mode
                let selectedService = store.state.column3?.selectedService;
                if (targetSlot === 1) {
                    selectedService = store.state.gearsets?.gs1Context?.selectedServiceSpecific
                        || store.state.gearsets?.gs1Context?.selectedService
                        || selectedService;
                } else if (targetSlot === 2) {
                    selectedService = store.state.gearsets?.gs2Context?.selectedServiceSpecific
                        || store.state.gearsets?.gs2Context?.selectedService
                        || selectedService;
                }
                // "__none__" means no service
                if (selectedService === '__none__') selectedService = null;
                console.log('selectedService from state:', selectedService);

                if (selectedService) {
                    requestData.service_id = selectedService;
                    console.log('Using selected service:', selectedService);
                } else {
                    console.log('No service selected, backend will auto-select');
                }

                // Add budget params if set. Prefer values from the budget
                // mode entry in the user's recipe priority list (the new
                // X-per-Y UI stores them there). Fall back to the legacy
                // class-level `this.budgetMaterials`/`this.budgetTarget`
                // which are still used during pre-XY-panel flows.
                let budgetMats = this.budgetMaterials;
                let budgetTarget = this.budgetTarget;
                const sm = window.settingsModal;
                const recipeEntries = sm?.recipeSorting || [];
                const budgetEntry = recipeEntries.find(
                    e => e && typeof e === 'object' && e.mode === 'budget'
                );
                if (budgetEntry) {
                    const m = parseInt(budgetEntry.budgetMats, 10);
                    const t = parseInt(budgetEntry.budgetTarget, 10);
                    if (!isNaN(m) && m > 0) budgetMats = m;
                    if (!isNaN(t) && t > 0) budgetTarget = t;
                }
                if (budgetMats > 0) {
                    requestData.budget_materials = budgetMats;
                }
                if (budgetTarget > 0) {
                    requestData.budget_target = budgetTarget;
                }
            }

            console.log('Final requestData:', requestData);

            // Add instant-actions flag if eligible and checked
            requestData.instant_actions = this._getInstantActionsFlag();
            // Add ability-stats pet flag if eligible and checked (e.g. Tiger hunting buff)
            requestData.pet_ability_stats = this._getAbilityStatsFlag();

            // Call API
            const response = await $.ajax({
                url: '/api/optimize-gearset',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(requestData)
            });

            console.log('Optimization response:', response);

            if (response.success) {
                // Client-side (Pyodide) path: the server returned request_data
                // instead of starting a server job. Run the optimizer locally,
                // POST the result back for identical DB persistence, then fall
                // into the same polling/render flow as a server run.
                if (response.run_local && response.request_data) {
                    if (!this._suppressResultUI) {
                        api.showSuccess('Optimizing locally in your browser...');
                    }
                    try {
                        const localResult = await this._runLocalOptimization(response.request_data);
                        const localSaveResp = await $.ajax({
                            url: '/api/optimize-gearset/local-result',
                            method: 'POST',
                            contentType: 'application/json',
                            data: JSON.stringify({
                                result: localResult,
                                opt_type: response.request_data.type,
                                sorting_priority: response.request_data.sorting_priority || []
                            })
                        });
                        // 2026-07-11 (bug 30add94e symptom #1): save_gear_set
                        // upserts optimized gearsets BY NAME, so a re-optimize
                        // reuses the same gearset id. startPollingForGearset only
                        // fires _handleOptimizationResult for a gearset id it did
                        // NOT already know, so a reused id was never detected —
                        // the button stayed "Optimizing…" and the (already saved)
                        // gears only showed after a manual press. The local path
                        // knows the exact saved id, so resolve + render it
                        // directly. Fall back to the poll/SSE path if the id is
                        // missing (older server) or the lookup fails.
                        const savedId = localSaveResp && localSaveResp.gear_set_id;
                        let handled = false;
                        if (savedId) {
                            try {
                                const gearSets = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                                const savedGs = (gearSets || []).find(gs => gs.id === savedId);
                                if (savedGs) {
                                    await this._handleOptimizationResult(savedGs, this._optimizingSlot);
                                    handled = true;
                                }
                            } catch (lookupErr) {
                                console.warn('[local-opt] direct result render failed, falling back to polling:', lookupErr);
                            }
                        }
                        if (!handled) this.startPollingForGearset();
                    } catch (localErr) {
                        console.error('[local-opt] failed:', localErr);
                        api.showError('Local optimization failed: ' +
                            (localErr && localErr.message ? localErr.message : localErr));
                        this.isOptimizing = false;
                        this.render();
                    }
                    return;
                }

                // Keep button in loading state while polling
                // Don't reset isOptimizing yet

                // Use server timestamp to avoid client/server clock skew
                const clientTime = this.optimizationStartTime;
                if (response.server_time) {
                    this.optimizationStartTime = response.server_time;
                    const skewMs = new Date(clientTime).getTime() - new Date(response.server_time).getTime();
                    console.log(`[OptDebug] Client startTime: ${clientTime}, Server startTime: ${response.server_time}, skew: ${skewMs}ms`);
                } else {
                    console.warn('[OptDebug] No server_time in response, using client clock (may cause clock skew issues)');
                }

                // Show success message (skip for slot-only optimization from popup)
                if (!this._suppressResultUI) {
                    api.showSuccess('Optimization started! Finding best gearset...');
                }

                // Start polling for new gearsets (keeps button in loading state)
                this.startPollingForGearset();
            } else {
                api.showError('Optimization failed to start');
                this.isOptimizing = false;
                this.render();
            }

        } catch (error) {
            console.error('Optimization error:', error);

            // Check for specific error messages
            if (error.responseJSON?.detail?.message) {
                const message = error.responseJSON.detail.message;
                const traceback = error.responseJSON.detail.traceback;

                if (traceback) {
                    console.error('Server traceback:', traceback);
                }

                api.showError(message);
            } else if (error.responseJSON?.detail) {
                api.showError(error.responseJSON.detail);
            } else if (error.responseText) {
                console.error('Response text:', error.responseText);
                api.showError('Optimization failed. Check console for details.');
            } else {
                api.showError('Optimization failed. Please try again.');
            }

            // Reset loading state on error
            this.isOptimizing = false;
            this.render();
        }
        // Note: Don't reset isOptimizing in finally - let polling handle it
    }

    /**
     * Get sorting priorities from session
     * @param {string} optType - 'activity' or 'recipe'
     * @returns {Array} Array of metric keys in priority order
     */
    async getSortingPriorities(optType) {
        try {
            const response = await $.get('/api/optimization-settings');
            let priorities = optType === 'activity' ?
                response.activity.current_order :
                response.recipe.current_order;

            // For non-quality recipes, filter out quality-specific sorting
            if (optType === 'recipe' && !this.isQualityRecipe()) {
                const qualitySpecificKeys = ['materials_for_target', 'steps_for_target', 'total_crafts'];
                priorities = priorities.filter(entry => {
                    // Legacy tuple form: [key, weight, target]
                    if (Array.isArray(entry)) {
                        return !qualitySpecificKeys.includes(entry[0]);
                    }
                    // Bare string form
                    if (typeof entry === 'string') {
                        return !qualitySpecificKeys.includes(entry);
                    }
                    // New X-per-Y dict form: any entry whose Y axis is
                    // 'quality' is quality-specific, regardless of which
                    // X axis it pairs with. Without this branch the
                    // includes() check below evaluates to includes(<object>)
                    // and never matches, so quality-specific dict entries
                    // pass through untouched and the optimizer scores
                    // ratios against meaningless near-zero quality
                    // probabilities for material outputs.
                    if (entry && typeof entry === 'object' && entry.mode === 'ratio') {
                        return entry.y !== 'quality';
                    }
                    return true;
                });
                console.log('Non-quality recipe, filtered priorities:', priorities);
            }

            // Skip collectibles if all obtained and setting is enabled
            if (optType === 'activity' && window.settingsModal?.skipObtainedCollectibles && this.dropTableData) {
                const collectibleDrops = this.dropTableData.filter(d =>
                    d.item_ref && d.item_ref.startsWith('Collectible.') && d.source !== 'equipment'
                );
                if (collectibleDrops.length > 0) {
                    const allOwned = collectibleDrops.every(d => {
                        const itemId = d.item_name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                        return store.state.items?.[itemId]?.has || false;
                    });
                    if (allOwned) {
                        // Remove entries targeting collectibles entirely — don't fall back.
                        // Support both legacy tuple form ([key, weight, target])
                        // and the new dict form ({mode, x, y, targetItem, ...}).
                        priorities = priorities.filter(entry => {
                            const target = Array.isArray(entry) ? entry[2] : (entry && entry.targetItem);
                            if (target === 'cat:collectibles') {
                                console.log('[Optimize] Removing collectibles priority (all obtained, skip enabled)');
                                return false;
                            }
                            return true;
                        });
                    }
                }
            }

            // Filter out priorities targeting categories that don't exist for this activity.
            // Supports legacy tuple ([key, weight, target]) and new dict form.
            if (optType === 'activity' && this.dropTableData) {
                priorities = priorities.filter(entry => {
                    const target = Array.isArray(entry) ? entry[2] : (entry && entry.targetItem);
                    if (target && target.startsWith('cat:') && !target.startsWith('cat:if:')) {
                        if (!this._isCategoryValidForActivity(target)) {
                            console.log(`[Optimize] Skipping invalid category "${target}" for this activity`);
                            return false;
                        }
                    }
                    return true;
                });
            }

            return priorities;
        } catch (error) {
            console.error('Failed to get sorting priorities:', error);

            // Return defaults
            if (optType === 'activity') {
                return ['steps_per_reward_roll', 'primary_xp_per_step', 'expected_steps_per_action'];
            } else {
                // For recipes, use non-quality defaults if needed
                if (!this.isQualityRecipe()) {
                    return ['expected_steps_per_item', 'primary_xp_per_step', 'materials_per_craft'];
                }
                return ['materials_for_target', 'steps_for_target', 'expected_steps_per_item'];
            }
        }
    }

    /**
     * Run an optimization locally in the browser via the Pyodide worker
     * (FAC: local_optimization). The worker stays alive across runs so Pyodide
     * boots once. All Python stdout/stderr is forwarded here and re-emitted via
     * console.log/console.error so it flows through debug-console.js and is
     * captured in bug reports. Resolves with the result dict.
     */
    _runLocalOptimization(requestData) {
        return runLocalCompute('optimize', { requestData });
    }

    /**
     * Start listening for optimization completion via SSE + fallback polling.
     * SSE gives instant notification; polling is a safety net.
     */
    startPollingForGearset() {
        let pollCount = 0;
        let elapsedMs = 0;
        const maxElapsedMs = 120000; // 2 minutes
        let stopped = false;
        let pollTimer = null;

        const startTime = this.optimizationStartTime;
        const capturedSlot = this._optimizingSlot; // Capture at poll start, not at result time

        // Snapshot the IDs of all currently-known optimized gearsets so we can
        // detect only NEW results — avoids picking up a previous optimization's
        // result when back-to-back optimizations run within the 10s clock buffer.
        const knownGearsetIds = new Set(
            Object.keys(store.state.gearsets.saved || {}).filter(id => {
                const gs = store.state.gearsets.saved[id];
                return gs && gs.is_optimized;
            })
        );
        console.log('Starting SSE + fallback polling, looking for gearsets created after:', startTime, 'targetSlot:', capturedSlot, 'knownOptimizedIds:', knownGearsetIds.size);

        const stop = () => {
            stopped = true;
            if (pollTimer) clearTimeout(pollTimer);
            if (this._sseSource) {
                this._sseSource.close();
                this._sseSource = null;
            }
        };

        // The core check: look for a new optimized gearset and handle it
        const checkForResult = async () => {
            try {
                const response = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                // Primary filter: gearset must not have been known when polling started.
                // This prevents picking up a previous optimization's result when two
                // optimizations run in quick succession (the 10s time buffer was too wide).
                const startDate = new Date(new Date(startTime).getTime() - 10000);
                const newGs = response.find(gs =>
                    gs.is_optimized &&
                    !knownGearsetIds.has(gs.id) &&
                    new Date(gs.created_at) > startDate
                );

                if (newGs) {
                    console.log('✓ New optimized gearset detected:', newGs.name, 'id:', newGs.id, 'for slot:', capturedSlot);
                    stop();
                    await this._handleOptimizationResult(newGs, capturedSlot);
                    return true;
                }

                // Debug: log why we didn't find a match
                const optimizedGs = response.filter(gs => gs.is_optimized);
                console.log(`[OptDebug] checkForResult: ${response.length} total gearsets, ${optimizedGs.length} optimized, cutoff=${startDate.toISOString()}, knownIds=${knownGearsetIds.size}`);
                if (optimizedGs.length > 0) {
                    const newest = optimizedGs.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b);
                    const isNew = !knownGearsetIds.has(newest.id);
                    console.log(`[OptDebug]   Newest optimized: "${newest.name}" id=${newest.id} created_at=${newest.created_at} isNew=${isNew} (${new Date(newest.created_at) > startDate ? 'AFTER' : 'BEFORE'} cutoff)`);
                }
            } catch (e) {
                console.error('Failed to check for gearset:', e);
            }
            return false;
        };

        // --- SSE: instant notification ---
        try {
            const sse = new EventSource('/api/optimization-events');
            this._sseSource = sse;

            sse.onmessage = async (event) => {
                console.log('SSE event received:', event.data);
                if (stopped) return;
                if (event.data === 'done' || event.data === 'timeout') {
                    sse.close();
                    this._sseSource = null;
                    // Give DB a moment to commit, then check with retries
                    // The worker may have just finished — SQLite needs a moment
                    // to make the committed data visible to new connections
                    let found = false;
                    for (let attempt = 0; attempt < 3 && !found && !stopped; attempt++) {
                        await new Promise(r => setTimeout(r, attempt === 0 ? 200 : 500));
                        found = await checkForResult();
                    }
                    if (!found && !stopped) {
                        // If the user cancelled (locally or via another tab), stay silent.
                        const cancelled = await this._checkCancelledFlag();
                        if (cancelled) {
                            stop();
                            this.isOptimizing = false;
                            this.render();
                            return;
                        }
                        // Worker finished but no gearset found — it failed
                        console.error(`[OptDebug] SSE path: worker finished (event=${event.data}) but no new gearset found after 3 attempts. startTime=${startTime}`);
                        stop();
                        api.showError('Optimization failed. Please try again or check your selection.');
                        this.isOptimizing = false;
                        this.render();
                    }
                }
            };

            sse.onerror = () => {
                // SSE connection failed — polling will handle it
                console.warn('SSE connection error, relying on polling fallback');
                sse.close();
                this._sseSource = null;
            };
        } catch (e) {
            console.warn('SSE not available, using polling only:', e);
        }

        // --- Fallback polling with ramping delay ---
        const getNextDelay = () => {
            if (elapsedMs < 1000) return 500;
            if (elapsedMs < 5000) return 1000;
            return 5000;
        };

        const poll = async () => {
            if (stopped) return;
            pollCount++;
            const delay = getNextDelay();
            elapsedMs += delay;

            try {
                // Check if optimization process is still alive
                const statusResponse = await $.get('/api/optimization-active');
                if (!statusResponse.active && pollCount > 1) {
                    // Process ended — do one final check with retries
                    let found = false;
                    for (let attempt = 0; attempt < 3 && !found && !stopped; attempt++) {
                        if (attempt > 0) await new Promise(r => setTimeout(r, 500));
                        found = await checkForResult();
                    }
                    if (!found && !stopped) {
                        // If the user cancelled, stay silent.
                        const cancelled = await this._checkCancelledFlag();
                        if (cancelled) {
                            stop();
                            this.isOptimizing = false;
                            this.render();
                            return;
                        }
                        console.error(`[OptDebug] Poll path: optimization inactive after ${pollCount} polls, no new gearset found after 3 attempts. startTime=${startTime}`);
                        stop();
                        api.showError('Optimization failed. Please try again or check your selection.');
                        this.isOptimizing = false;
                        this.render();
                    }
                    return;
                }

                // Normal poll: check for new gearset
                const found = await checkForResult();
                if (found) return;

            } catch (error) {
                console.error('Poll error:', error);
            }

            if (elapsedMs >= maxElapsedMs) {
                stop();
                console.log('Polling timeout');
                this.isOptimizing = false;
                this.render();
                return;
            }

            pollTimer = setTimeout(poll, getNextDelay());
        };

        // Start first poll after initial delay
        pollTimer = setTimeout(poll, getNextDelay());
    }

    /**
     * Handle a detected optimization result (shared by SSE and polling paths)
     */
    async _handleOptimizationResult(gearset, capturedSlot = null) {
        const hasReqWarning = gearset.slots_json?._requirements_warning;
        const autoEquip = window.settingsModal?.autoEquipOptimized;
        const targetSlot = capturedSlot || this._optimizingSlot;
        const suppressUI = this._suppressResultUI;
        this._suppressResultUI = false; // Reset for next optimization
        this._findAlternativesOnly = false;

        if (suppressUI) {
            // Triggered from popup's "Optimize Slot & Equip" — the popup handles
            // equipping and re-rendering itself, so just refresh gearsets silently
            try {
                const freshGearSets = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                store.state.gearsets.saved = {};
                freshGearSets.forEach(gs => {
                    store.state.gearsets.saved[gs.id] = {
                        name: gs.name,
                        slots: gs.slots_json,
                        export_string: gs.export_string,
                        is_optimized: gs.is_optimized
                    };
                });
                store._notifySubscribers('gearsets.saved');
            } catch (e) {
                console.error('Failed to reload gearsets for slot optimization:', e);
            }
        } else if (autoEquip || targetSlot) {
            try {
                const freshGearSets = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                store.state.gearsets.saved = {};
                freshGearSets.forEach(gs => {
                    store.state.gearsets.saved[gs.id] = {
                        name: gs.name,
                        slots: gs.slots_json,
                        export_string: gs.export_string,
                        is_optimized: gs.is_optimized
                    };
                });
                store._notifySubscribers('gearsets.saved');

                // In comparison mode, equip to the target slot
                if (targetSlot === 2) {
                    await store.loadGearSetToSlot2(gearset.id);
                } else {
                    await store.loadGearSet(gearset.id);
                }
            } catch (e) {
                console.error('Failed to reload gearsets for auto-equip:', e);
            }
            const slotLabel = targetSlot ? ` to Set ${targetSlot}` : '';
            if (hasReqWarning) {
                api.showInfo(`Optimization complete! Equipped${slotLabel}: ${gearset.name}\n⚠️ Requirements could not be met due to locked gear slots.`);
            } else {
                api.showSuccess(`Optimization complete! Equipped${slotLabel}: ${gearset.name}`, { duration: 5000 });
            }
        } else {
            this.optimizedGearsetId = gearset.id;
            this.showEquipButton = true;

            if (hasReqWarning) {
                const toastHtml = `⚠️ Optimization complete: ${gearset.name}<br><span style="opacity:0.8;font-size:0.9em;">Requirements could not be met due to locked gear slots. Click to equip.</span>`;
                api.showInfo(null, { html: toastHtml, duration: 10000, onClick: () => this.equipOptimizedGearset() });
            } else {
                const toastHtml = `Optimization complete! Saved: ${gearset.name}<br><span style="opacity:0.8;font-size:0.9em;">Click to equip optimized gear set</span>`;
                api.showSuccess(null, { html: toastHtml, duration: 10000, onClick: () => this.equipOptimizedGearset() });
            }
            // Refresh saved gearsets list (auto-equip path already refreshed above)
            store._loadGearSets(store.state.session.uuid);
        }

        // Gearsets already refreshed above during auto-equip
        this.isOptimizing = false;
        store._skipGearset2Copy = false;
        this.render();

        // Check for owned-but-locked items that are locked due to custom stats
        // (e.g. Hydrilium diving gear locked because user hasn't toggled "Underwater Swimming x25")
        this._checkCustomStatsLockedAlternatives(gearset);

        // Auto-copy export string to clipboard if enabled
        const autoCopyExport = window.settingsModal?.autoCopyExport;
        if (autoCopyExport && gearset.export_string) {
            try {
                await navigator.clipboard.writeText(gearset.export_string);
                api.showInfo('Export string copied to clipboard', { duration: 3000 });
            } catch (e) {
                console.error('Failed to auto-copy export string:', e);
            }
        }

        // Notify any listeners that optimization is complete (e.g. item-selection-popup)
        window.dispatchEvent(new CustomEvent('optimization-complete', { detail: { gearset } }));
    }

    /**
     * Check if there are owned-but-locked items that would be better,
     * specifically locked due to custom stats (activity completions, region access).
     * Shows a yellow warning toast directing the user to the Custom Stats popup.
     */
    _checkCustomStatsLockedAlternatives(gearset) {
        // Check if user has disabled custom stats notifications
        if (store.state.ui.custom_stats?.show_notification === false) return;

        const lockedAlts = gearset.slots_json?._locked_alternatives;
        console.log('[custom-stats-check] lockedAlts:', lockedAlts);
        if (!lockedAlts) return;

        // RED case (handled first, independent of the custom-stats items below):
        // the activity requires gear the user owns NONE of, so it can't be
        // unlocked via a custom stat — it's simply missing. The backend stashes
        // this under a reserved, non-slot key.
        const unmetRequired = lockedAlts['__unmet_required__'];
        if (Array.isArray(unmetRequired) && unmetRequired.length > 0) {
            const titleCase = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const reqList = unmetRequired.map(u => `${u.required}× ${titleCase(u.keyword)}`).join(', ');
            const redHtml = `🚫 Can't optimize for this — you don't own the required gear (${reqList}).`;
            setTimeout(() => {
                api.showError(null, { html: redHtml, duration: 15000 });
            }, 500);
        }

        // Collect items locked specifically due to custom stats (skip the
        // reserved non-slot key used for the red toast above).
        const customStatsItems = [];
        const customStatsIds = new Set();
        const slotNames = new Set();

        for (const [slot, items] of Object.entries(lockedAlts)) {
            if (slot === '__unmet_required__') continue;
            if (!Array.isArray(items)) continue;
            for (const item of items) {
                console.log(`[custom-stats-check] slot=${slot} item=${item.name} is_custom_stats_locked=${item.is_custom_stats_locked} custom_stats_needed=${JSON.stringify(item.custom_stats_needed)}`);
                if (item.is_custom_stats_locked) {
                    customStatsItems.push(item);
                    slotNames.add(slot);
                    if (item.custom_stats_needed) {
                        item.custom_stats_needed.forEach(id => customStatsIds.add(id));
                    }
                }
            }
        }

        console.log('[custom-stats-check] customStatsItems count:', customStatsItems.length);
        if (customStatsItems.length === 0) return;

        // Strip the quality suffix so quality variants collapse to one base name.
        const stripQuality = (name) => {
            let n = name;
            for (const q of ['(Eternal)', '(Perfect)', '(Excellent)', '(Great)', '(Good)', '(Normal)']) {
                n = n.replace(` ${q}`, '');
            }
            return n;
        };
        const uniqueNamesFor = (items) => [...new Set(items.map(i => stripQuality(i.name)))];
        const formatList = (names) => names.length <= 3
            ? names.join(', ')
            : names.slice(0, 2).join(', ') + ` and ${names.length - 2} more`;

        // Two distinct cases, two distinct messages:
        //  - REQUIRED: the gear is needed to perform the activity at all (multi-piece
        //    keyword requirement the optimizer couldn't satisfy because it's locked).
        //  - UPGRADE: the gear isn't required but would score better if unlocked.
        const requiredItems = customStatsItems.filter(i => i.is_requirement);
        const upgradeItems = customStatsItems.filter(i => !i.is_requirement);

        const openCustomStats = () => {
            if (window.customStatsPopup) {
                window.customStatsPopup.show();
            }
        };
        const showLockedToast = (html, delay) => {
            setTimeout(() => {
                api.showWarning(null, { html, duration: 15000, onClick: openCustomStats });
            }, delay);
        };

        let delay = 500;  // slight delay so it doesn't collide with the success toast

        if (requiredItems.length > 0) {
            const names = uniqueNamesFor(requiredItems);
            const one = names.length === 1;
            const html = `⚠️ You own <strong>${formatList(names)}</strong> which ${one ? 'is' : 'are'} required for this, but ${one ? "it's" : "they're"} locked behind custom stats.<br><span style="opacity:0.85;font-size:0.9em;">Click here to open Custom Stats and unlock ${one ? 'it' : 'them'}.</span>`;
            showLockedToast(html, delay);
            delay += 600;  // stagger if both toasts fire
        }

        if (upgradeItems.length > 0) {
            const names = uniqueNamesFor(upgradeItems);
            const one = names.length === 1;
            const html = `⚠️ You own <strong>${formatList(names)}</strong> which would be better, but ${one ? "it's" : "they're"} locked behind custom stats.<br><span style="opacity:0.85;font-size:0.9em;">Click here to open Custom Stats and unlock ${one ? 'it' : 'them'}.</span>`;
            showLockedToast(html, delay);
        }
    }

    /**
     * Render target dropdown content — category-based for activities, quality for recipes
     */
    renderTargetDropdownContent() {
        if (this.selectedActivity) {
            return this._renderActivityTargetDropdown();
        } else if (this.selectedRecipe) {
            // Recipe: show quality options
            const qualities = [
                { name: 'Normal', value: 'Normal', color: 'var(--rarity-common)' },
                { name: 'Good', value: 'Good', color: 'var(--rarity-uncommon)' },
                { name: 'Great', value: 'Great', color: 'var(--rarity-rare)' },
                { name: 'Excellent', value: 'Excellent', color: 'var(--rarity-epic)' },
                { name: 'Perfect', value: 'Perfect', color: 'var(--rarity-legendary)' },
                { name: 'Eternal', value: 'Eternal', color: 'var(--rarity-ethereal)' }
            ];

            return qualities.map(q => `
                <div class="target-item quality-item" data-value="${q.value}" style="background: ${q.color};">
                    <span>${q.name}</span>
                </div>
            `).join('');
        }

        return '';
    }

    /**
     * Build category-based target dropdown for activities.
     * Categories: Normal Items, Chests, Collectibles, Fine, Gems, item finding categories
     */
    _renderActivityTargetDropdown() {
        // If no drop table loaded (e.g. configuring settings modal while no activity
        // is selected in column 3), render with an empty drop table so all categories
        // are still listed (with N/A for unavailable ones).
        if (!this.dropTableData) {
            this.dropTableData = [];
        }

        const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';

        // Separate regular drops from equipment (item finding) drops
        const regularDrops = this.dropTableData.filter(d => d.item_name !== 'Nothing' && d.source !== 'equipment');
        const equipmentDrops = this.dropTableData.filter(d => d.item_name !== 'Nothing' && d.source === 'equipment');

        // Categorize regular drops
        const chestDrops = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Container.'));
        const collectibleDrops = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Collectible.'));
        const fineDrops = regularDrops.filter(d => d.has_fine_material);

        // Gem detection: items with gem-related keywords or known gem item refs
        const gemRefs = new Set([
            'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
            'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
            'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE',
            'Material.OPAL', 'Material.STAR_PEARL', 'Material.TOPAZ',
            'Material.WRENTMARINE', 'Material.JADE', 'Material.RUBY',
            'Material.SUN_STONE', 'Material.ETHERNITE'
        ]);
        const gemDrops = regularDrops.filter(d =>
            (d.item_ref && gemRefs.has(d.item_ref)) ||
            (d.item_keywords && d.item_keywords.some(kw =>
                kw === 'gem' || kw === 'rough_gem' || kw === 'cut_gem' || kw === 'Gem' || kw === 'Rough gem' || kw === 'Cut gem'
            ))
        );
        const gemFineDrops = gemDrops.filter(d => d.has_fine_material);

        // Item finding category items (from RANDOM_GEM category)
        const ifGemItems = new Set([
            'Rough opal', 'Rough star pearl', 'Rough topaz', 'Rough wrentmarine',
            'Rough jade', 'Rough ruby', 'Rough sun stone', 'Rough ethernite'
        ]);
        const activityGemNames = new Set(gemDrops.map(d => d.item_name));
        const allGemsFromActivity = [...ifGemItems].every(name => activityGemNames.has(name));

        // Build the dropdown items
        const items = [];

        // 1. Normal Items (always first)
        items.push({
            name: 'Normal Items',
            value: 'cat:normal_items',
            icon: '/assets/icons/attributes/double_rewards.svg',
            infoItems: regularDrops.filter(d => !chestDrops.includes(d) && !collectibleDrops.includes(d))
                .map(d => d.item_name).sort()
        });

        // 2. Chests (always show — collapsed view shows N/A if no drops)
        {
            const chestNames = chestDrops.map(d => d.item_name).sort();
            items.push({
                name: 'Chests',
                value: 'cat:chests',
                icon: '/assets/icons/keywords/chest.svg',
                infoItems: chestNames,
                unavailable: chestDrops.length === 0
            });
        }

        // 2a. Coins / Coins (no chests) — synthetic aggregate targets
        // that score on total coins/step across all drops. Placed
        // alphabetically after Chests and before Collectibles. Always
        // available; the scorer handles activities with or without
        // chest drops.
        items.push({
            name: 'Coins',
            value: 'cat:coins',
            icon: '/assets/icons/items/coins.svg',
        });
        items.push({
            name: 'Coins (no chests)',
            value: 'cat:coins_no_chests',
            icon: '/assets/icons/items/coins.svg',
        });

        // 3. Collectibles (always show)
        {
            const collectibleOwnership = collectibleDrops.map(d => {
                const itemId = d.item_name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                return { name: d.item_name, owned: store.state.items?.[itemId]?.has || false };
            });
            const allOwned = collectibleDrops.length > 0 && collectibleOwnership.every(c => c.owned);
            const collectibleSuffix = allOwned ? ' <span style="font-size:0.85em;white-space:nowrap;">(already obtained. <span style="color:#27ae60;">Nice!</span> 🎉)</span>' : '';

            items.push({
                name: 'Collectibles',
                nameSuffix: collectibleSuffix,
                allObtained: allOwned,
                value: 'cat:collectibles',
                icon: '/assets/icons/keywords/collectible.svg',
                infoItems: collectibleDrops.length > 0
                    ? collectibleOwnership.map(c =>
                        c.owned ? `__owned__${c.name} (already obtained. Nice! 🎉)` : c.name
                    ).sort()
                    : [],
                unavailable: collectibleDrops.length === 0
            });
        }

        // 4. Fine Items (always show)
        {
            items.push({
                name: 'Fine Items',
                value: 'cat:fine',
                icon: '/assets/icons/keywords/fine_material.svg',
                infoItems: fineDrops.map(d => `${d.item_name} (Fine)`).sort(),
                unavailable: fineDrops.length === 0
            });
        }

        // 5. Gems from activity (always show)
        {
            items.push({
                name: 'Gems',
                value: 'cat:gems',
                icon: '/assets/icons/keywords/gem.svg',
                infoItems: gemDrops.map(d => d.item_name).sort(),
                unavailable: gemDrops.length === 0
            });
            items.push({
                name: 'Gems (Fine)',
                value: 'cat:gems_fine',
                icon: '/assets/icons/keywords/gem.svg',
                isFine: true,
                infoItems: gemFineDrops.map(d => `${d.item_name} (Fine)`).sort(),
                unavailable: gemFineDrops.length === 0
            });
        }

        // 7. Item finding categories (checkbox-gated, alphabetical)
        if (showItemFinding) {
            // Item finding categories with icons and drop info
            // Single-item categories: use the item's own icon, no (ⓘ)
            // Multi-item categories: use keyword icon, show (ⓘ) with items + percentages
            const ifCategories = [
                { name: "Adventurers' Guild Tokens", value: 'cat:if:adventurers_guild_tokens', icon: "/assets/icons/items/adventurers'_guild_token.svg" },
                { name: 'Bird Nest', value: 'cat:if:bird_nest', icon: '/assets/icons/items/containers/bird_nest.svg' },
                {
                    name: 'Crustacean', value: 'cat:if:crustacean', icon: '/assets/icons/keywords/crustacean.svg',
                    infoItems: ['Raw crab', 'Raw lobster', 'Raw shrimp']
                },
                {
                    name: 'Crustacean (Fine)', value: 'cat:if:crustacean_fine', icon: '/assets/icons/keywords/crustacean.svg', isFine: true,
                    infoItems: ['Raw crab (Fine)', 'Raw lobster (Fine)', 'Raw shrimp (Fine)']
                },
                { name: 'Ectoplasm', value: 'cat:if:ectoplasm', icon: '/assets/icons/items/materials/ectoplasm.svg' },
                { name: 'Ectoplasm (Fine)', value: 'cat:if:ectoplasm_fine', icon: '/assets/icons/items/materials/ectoplasm.svg', isFine: true },
                {
                    name: 'Fibrous Plant', value: 'cat:if:fibrous_plant', icon: '/assets/icons/keywords/fibrous_plant.svg',
                    infoItems: ['Hemp', 'Flax']
                },
                {
                    name: 'Fibrous Plant (Fine)', value: 'cat:if:fibrous_plant_fine', icon: '/assets/icons/keywords/fibrous_plant.svg', isFine: true,
                    infoItems: ['Hemp (Fine)', 'Flax (Fine)']
                },
                {
                    name: 'Fishing Bait', value: 'cat:if:fishing_bait', icon: '/assets/icons/keywords/fishing.svg',
                    infoItems: ['Bug bait', 'Frozen bait']
                },
                {
                    name: 'Fishing Bait (Fine)', value: 'cat:if:fishing_bait_fine', icon: '/assets/icons/keywords/fishing.svg', isFine: true,
                    infoItems: ['Bug bait (Fine)', 'Frozen bait (Fine)']
                },
                { name: 'Gold Nugget', value: 'cat:if:gold_nugget', icon: '/assets/icons/items/materials/gold_nugget.svg' },
                { name: 'Gold Nugget (Fine)', value: 'cat:if:gold_nugget_fine', icon: '/assets/icons/items/materials/gold_nugget.svg', isFine: true },
                {
                    name: 'Random Gem', value: 'cat:if:random_gem', icon: '/assets/icons/keywords/gem.svg',
                    infoItems: ['Rough opal', 'Rough star pearl', 'Rough topaz', 'Rough wrentmarine', 'Rough jade', 'Rough ruby', 'Rough sun stone', 'Rough ethernite']
                },
                {
                    name: 'Random Gem (Fine)', value: 'cat:if:random_gem_fine', icon: '/assets/icons/keywords/gem.svg', isFine: true,
                    infoItems: ['Rough opal (Fine)', 'Rough star pearl (Fine)', 'Rough topaz (Fine)', 'Rough wrentmarine (Fine)', 'Rough jade (Fine)', 'Rough ruby (Fine)', 'Rough sun stone (Fine)', 'Rough ethernite (Fine)']
                },
                {
                    name: 'Random Piece of Junk', value: 'cat:if:random_piece_of_junk', icon: '/assets/icons/keywords/trash.svg',
                    infoItems: ['Trash', 'Fishbone', 'Grass', 'Mud', 'Copper arrows', 'Milkweed', 'Moondaisy', 'Sea shell', 'Birch skis', 'Clay skydisc', 'Rough opal', 'Simple torch', 'Rusty chest', 'Sunken chest']
                },
                {
                    name: 'Random Piece of Junk (Fine)', value: 'cat:if:random_piece_of_junk_fine', icon: '/assets/icons/keywords/trash.svg', isFine: true,
                    infoItems: ['Trash (Fine)', 'Fishbone (Fine)', 'Grass (Fine)', 'Mud (Fine)', 'Copper arrows (Fine)', 'Milkweed (Fine)', 'Moondaisy (Fine)', 'Sea shell (Fine)']
                },
                {
                    name: 'Random Skill Chest', value: 'cat:if:skill_chest', icon: '/assets/icons/keywords/skilling_chest.svg',
                    infoItems: ['Agility chest', 'Carpentry chest', 'Cooking chest', 'Crafting chest', 'Fishing chest', 'Foraging chest', 'Hunting chest', 'Mining chest', 'Smithing chest', 'Tailoring chest', 'Trinketry chest', 'Woodcutting chest']
                },
                { name: 'Sea Shells', value: 'cat:if:sea_shells', icon: '/assets/icons/items/materials/sea_shell.svg' },
            ].sort((a, b) => a.name.localeCompare(b.name));

            // Filter: don't show item finding category if ALL its items are already in the activity's regular drops
            // (e.g., Sea Shells has only 1 item — if the activity drops sea shells, skip the IF version)
            const ifCategoryItemSets = {
                'cat:if:sea_shells': new Set(['Sea shell']),
                'cat:if:adventurers_guild_tokens': new Set(["Adventurers' guild token"]),
                'cat:if:ectoplasm': new Set(['Ectoplasm']),
                'cat:if:gold_nugget': new Set(['Gold nugget']),
                'cat:if:bird_nest': new Set(['Bird nest']),
                'cat:if:random_gem': ifGemItems,
            };

            const regularDropNames = new Set(regularDrops.map(d => d.item_name));

            for (const cat of ifCategories) {
                // Skip if already added as "from activity" above (gems case)
                if (items.some(i => i.value === cat.value)) continue;

                // Skip if all items in this category are already in regular drops
                const catItems = ifCategoryItemSets[cat.value.replace('_fine', '')];
                if (catItems && [...catItems].every(name => regularDropNames.has(name))) continue;

                items.push({
                    ...cat,
                    isEquipmentDrop: true
                });
            }
        }

        // Render
        return items.map(item => {
            const fineClass = item.isFine ? 'fine-item' : '';
            const equipClass = item.isEquipmentDrop ? 'equipment-drop-item' : '';
            const prefix = item.isEquipmentDrop ? '✦ ' : '';

            // Build info popover HTML content: list of items with 32x32 icons
            let infoIconHtml = '';
            if (item.infoItems && item.infoItems.length > 0) {
                const itemListHtml = item.infoItems.map(entry => {
                    // Check for __owned__ prefix (collectibles that are already obtained)
                    const isOwned = entry.startsWith('__owned__');
                    const cleanEntry = isOwned ? entry.replace('__owned__', '') : entry;

                    const plainEntry = cleanEntry.replace(/<[^>]+>/g, '');
                    const isFineEntry = plainEntry.includes('(Fine)');
                    const nameOnly = plainEntry.replace(/ \(Fine\)/, '').replace(/ \(already obtained\. Nice! 🎉\)/, '').replace(/ \(already obtained 🎉\)/, '').replace(/ \(already obtained\)/, '').trim();
                    const iconName = nameOnly.toLowerCase().replace(/ /g, '_').replace(/'/g, "'");
                    const iconPath = this._guessItemIconPath(iconName, item.value);
                    const fineStyle = isFineEntry ? ' filter:drop-shadow(1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(-1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(0 1px 0 var(--fine-color,#4fc3f7)) drop-shadow(0 -1px 0 var(--fine-color,#4fc3f7));' : '';
                    const ownedStyle = isOwned ? ' style="color:var(--text-muted);font-style:italic;"' : '';
                    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;"><img src="${iconPath}" style="width:32px;height:32px;${fineStyle}" onerror="this.style.display='none'" /><span${ownedStyle}>${cleanEntry}</span></div>`;
                }).join('');
                const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
                infoIconHtml = ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.9em;font-style:normal;">ⓘ</span>`;
            }

            const obtainedStyle = item.allObtained ? ' style="color:var(--text-muted);font-style:italic;"' : '';
            const unavailableStyle = item.unavailable ? ' style="opacity:0.5;font-style:italic;"' : '';
            const unavailableLabel = item.unavailable ? ' <span style="color:#f1c40f;font-size:0.8em;font-weight:bold;">N/A</span>' : '';
            const itemStyle = item.allObtained ? obtainedStyle : unavailableStyle;

            return `
                <div class="target-item ${fineClass} ${equipClass}" data-value="${item.value}"${itemStyle}>
                    <img src="${item.icon}" alt="${item.name}" class="target-icon" />
                    <span>${prefix}${item.name}${unavailableLabel}${item.nameSuffix || ''}${infoIconHtml}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Get icon path for a drop (EXACT same logic as drops-section.js)
     */
    getDropIcon(drop) {
        let iconPath = '';

        // Special case for coins
        if (drop.item_name === 'Coins') {
            iconPath = '/assets/icons/items/coins.svg';
        } else if (drop.item_ref) {
            // Parse item reference to get icon path
            // Format: "Material.ITEM_NAME" or "Item.ITEM_NAME" or "Collectible.ITEM_NAME"
            const [type, itemName] = drop.item_ref.split('.');

            // Use the actual item name from drop.item_name for the icon filename (lowercase)
            // This preserves apostrophes and uses lowercase
            const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');

            if (type === 'Currency') {
                iconPath = `/assets/icons/items/${iconName}.svg`;
            } else if (type === 'Material') {
                iconPath = `/assets/icons/items/materials/${iconName}.svg`;
            } else if (type === 'Item') {
                iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
            } else if (type === 'Collectible') {
                iconPath = `/assets/icons/items/collectibles/${iconName}.svg`;
            } else if (type === 'Consumable') {
                iconPath = `/assets/icons/items/consumables/${iconName}.svg`;
            } else if (type === 'Container') {
                iconPath = `/assets/icons/items/containers/${iconName}.svg`;
            } else if (type === 'Egg') {
                iconPath = `/assets/icons/items/pet_eggs/${iconName}.svg`;
            }
        }

        // Fallback: if no icon path determined, try to infer from item name (lowercase)
        if (!iconPath && drop.item_name) {
            // Convert to icon filename: lowercase, spaces to underscores, keep apostrophes
            const itemNameFormatted = drop.item_name.toLowerCase().replace(/ /g, '_');
            // Detect pet eggs by name pattern
            if (drop.item_name.toLowerCase().endsWith(' egg')) {
                iconPath = `/assets/icons/items/pet_eggs/${itemNameFormatted}.svg`;
            } else {
                // Try materials first, then consumables
                iconPath = `/assets/icons/items/materials/${itemNameFormatted}.svg`;
            }
        }

        return iconPath || '/assets/icons/items/materials/placeholder.svg';
    }

    /**
     * Guess the icon path for an item name based on the category context.
     * Uses the drop table data if available, otherwise tries common paths.
     */
    _guessItemIconPath(iconName, categoryValue) {
        // Try to find in drop table data for exact match
        if (this.dropTableData) {
            const drop = this.dropTableData.find(d =>
                d.item_name.toLowerCase().replace(/ /g, '_') === iconName
            );
            if (drop) return this.getDropIcon(drop);
        }

        // Category-based guessing
        if (categoryValue && (categoryValue.includes('chest') || categoryValue.includes('skill_chest') || categoryValue.includes('bird_nest'))) {
            return `/assets/icons/items/containers/${iconName}.svg`;
        }
        if (categoryValue && categoryValue.includes('collectible')) {
            return `/assets/icons/items/collectibles/${iconName}.svg`;
        }
        if (categoryValue && categoryValue.includes('fishing_bait')) {
            return `/assets/icons/items/consumables/${iconName}.svg`;
        }
        // Default: materials (most common)
        return `/assets/icons/items/materials/${iconName}.svg`;
    }

    /**
     * Check if a category target is valid for the current activity's drop table.
     * Returns true if the category has matching drops, false if not.
     */
    _isCategoryValidForActivity(categoryValue) {
        if (!categoryValue || !this.dropTableData) return true; // Assume valid if no data
        if (categoryValue === 'cat:normal_items' || categoryValue === 'raw_rewards') return true; // Always valid
        if (categoryValue.startsWith('cat:if:')) return true; // Item finding always valid
        // Coin aggregates are always valid — every activity produces some
        // sellable drop, and the "no chests" variant still works even when
        // an activity has no chest drops (contribution just happens to be 0).
        if (categoryValue === 'cat:coins' || categoryValue === 'cat:coins_no_chests') return true;

        const regularDrops = this.dropTableData.filter(d => d.item_name !== 'Nothing' && d.source !== 'equipment');

        if (categoryValue === 'cat:chests') {
            return regularDrops.some(d => d.item_ref && d.item_ref.startsWith('Container.'));
        }
        if (categoryValue === 'cat:collectibles') {
            return regularDrops.some(d => d.item_ref && d.item_ref.startsWith('Collectible.'));
        }
        if (categoryValue === 'cat:fine') {
            return regularDrops.some(d => d.has_fine_material);
        }
        if (categoryValue === 'cat:gems' || categoryValue === 'cat:gems_fine') {
            const gemRefs = new Set([
                'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
                'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
                'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE'
            ]);
            return regularDrops.some(d => d.item_ref && gemRefs.has(d.item_ref));
        }
        return true;
    }

    /**
     * Build an (ⓘ) info icon HTML for a category value, showing items with icons.
     * Returns empty string for single-item categories or unknown categories.
     */
    _buildCategoryInfoIcon(categoryValue) {
        if (!categoryValue || !this.dropTableData) return '';

        let itemEntries = []; // {name, owned} objects

        // Activity categories: get items from drop table
        if (categoryValue === 'cat:normal_items' || categoryValue === 'raw_rewards') {
            const regularDrops = this.dropTableData.filter(d => d.item_name !== 'Nothing' && d.source !== 'equipment');
            const containerRefs = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Container.'));
            const collectibleRefs = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Collectible.'));
            itemEntries = regularDrops
                .filter(d => !containerRefs.includes(d) && !collectibleRefs.includes(d))
                .map(d => ({ name: d.item_name })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (categoryValue === 'cat:chests') {
            itemEntries = this.dropTableData
                .filter(d => d.item_ref && d.item_ref.startsWith('Container.') && d.source !== 'equipment')
                .map(d => ({ name: d.item_name })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (categoryValue === 'cat:collectibles') {
            // Check owned status for each collectible
            itemEntries = this.dropTableData
                .filter(d => d.item_ref && d.item_ref.startsWith('Collectible.') && d.source !== 'equipment')
                .map(d => {
                    const itemId = d.item_name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                    const owned = store.state.items?.[itemId]?.has || false;
                    return { name: d.item_name, owned };
                }).sort((a, b) => a.name.localeCompare(b.name));
        } else if (categoryValue === 'cat:fine') {
            itemEntries = this.dropTableData
                .filter(d => d.has_fine_material && d.source !== 'equipment')
                .map(d => ({ name: `${d.item_name} (Fine)` })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (categoryValue === 'cat:gems' || categoryValue === 'cat:gems_fine') {
            const gemRefs = new Set([
                'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
                'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
                'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE'
            ]);
            const gems = this.dropTableData.filter(d => d.item_ref && gemRefs.has(d.item_ref) && d.source !== 'equipment');
            itemEntries = categoryValue.includes('fine')
                ? gems.filter(d => d.has_fine_material).map(d => ({ name: `${d.item_name} (Fine)` })).sort((a, b) => a.name.localeCompare(b.name))
                : gems.map(d => ({ name: d.item_name })).sort((a, b) => a.name.localeCompare(b.name));
        } else if (categoryValue.startsWith('cat:if:')) {
            // Item finding categories — use known item lists
            const ifItemLists = {
                'cat:if:adventurers_guild_tokens': ["Adventurers' guild token"],
                'cat:if:adventurers_guild_tokens_fine': ["Adventurers' guild token (Fine)"],
                'cat:if:bird_nest': ['Bird nest'],
                'cat:if:bird_nest_fine': ['Bird nest (Fine)'],
                'cat:if:crustacean': ['Crab', 'Lobster', 'Shrimp'],
                'cat:if:crustacean_fine': ['Crab (Fine)', 'Lobster (Fine)', 'Shrimp (Fine)'],
                'cat:if:ectoplasm': ['Ectoplasm'],
                'cat:if:ectoplasm_fine': ['Ectoplasm (Fine)'],
                'cat:if:fibrous_plant': ['Hemp', 'Flax'],
                'cat:if:fibrous_plant_fine': ['Hemp (Fine)', 'Flax (Fine)'],
                'cat:if:fishing_bait': ['Bug bait', 'Frozen bait'],
                'cat:if:fishing_bait_fine': ['Bug bait (Fine)', 'Frozen bait (Fine)'],
                'cat:if:gold_nugget': ['Gold nugget'],
                'cat:if:gold_nugget_fine': ['Gold nugget (Fine)'],
                'cat:if:random_gem': ['Rough opal', 'Rough star pearl', 'Rough topaz', 'Rough wrentmarine', 'Rough jade', 'Rough ruby', 'Rough sun stone', 'Rough ethernite'],
                'cat:if:random_gem_fine': ['Rough opal (Fine)', 'Rough star pearl (Fine)', 'Rough topaz (Fine)', 'Rough wrentmarine (Fine)', 'Rough jade (Fine)', 'Rough ruby (Fine)', 'Rough sun stone (Fine)', 'Rough ethernite (Fine)'],
                'cat:if:random_piece_of_junk': ['Trash', 'Fishbone', 'Grass', 'Mud', 'Copper arrows', 'Milkweed', 'Moondaisy', 'Sea shell', 'Birch skis', 'Clay skydisc', 'Rough opal', 'Simple torch', 'Rusty chest', 'Sunken chest'],
                'cat:if:random_piece_of_junk_fine': ['Trash (Fine)', 'Fishbone (Fine)', 'Grass (Fine)', 'Mud (Fine)', 'Copper arrows (Fine)', 'Milkweed (Fine)', 'Moondaisy (Fine)', 'Sea shell (Fine)'],
                'cat:if:skill_chest': ['Agility chest', 'Carpentry chest', 'Cooking chest', 'Crafting chest', 'Fishing chest', 'Foraging chest', 'Hunting chest', 'Mining chest', 'Smithing chest', 'Tailoring chest', 'Trinketry chest', 'Woodcutting chest'],
                'cat:if:sea_shells': ['Sea shell'],
            };
            const names = ifItemLists[categoryValue] || [];
            itemEntries = names.map(n => ({ name: n })).sort((a, b) => a.name.localeCompare(b.name));
        }

        // Always show (ⓘ) for chests, collectibles, and item finding categories
        // For other categories, skip if only 1 item
        const alwaysShowInfo = categoryValue === 'cat:chests' || categoryValue === 'cat:collectibles' || categoryValue.startsWith('cat:if:');
        if (itemEntries.length === 0) return '';
        if (itemEntries.length <= 1 && !alwaysShowInfo) return '';

        const itemListHtml = itemEntries.map(entry => {
            const isFineEntry = entry.name.includes('(Fine)');
            const nameOnly = entry.name.replace(/ \(Fine\)/, '');
            const iconName = nameOnly.toLowerCase().replace(/ /g, '_');
            const iconPath = this._guessItemIconPath(iconName, categoryValue);
            const fineStyle = isFineEntry ? ' filter:drop-shadow(1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(-1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(0 1px 0 var(--fine-color,#4fc3f7)) drop-shadow(0 -1px 0 var(--fine-color,#4fc3f7));' : '';
            const ownedStyle = entry.owned ? ' style="color:var(--text-muted);font-style:italic;"' : '';
            const ownedSuffix = entry.owned ? ' (already obtained. <span style="color:#27ae60;">Nice!</span> 🎉)' : '';
            return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;"><img src="${iconPath}" style="width:32px;height:32px;${fineStyle}" onerror="this.style.display='none'" /><span${ownedStyle}>${entry.name}${ownedSuffix}</span></div>`;
        }).join('');
        const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
        return ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.85em;font-style:normal;">ⓘ</span>`;
    }

    /**
     * Get display name for current target
     */
    getTargetDisplayName() {
        if (this.selectedActivity) {
            return this._getCategoryDisplayName(this.targetDrop);
        } else if (this.selectedRecipe) {
            return this.targetQuality;
        }
        return '';
    }

    /**
     * Get category display name from a category value or legacy item name
     */
    _getCategoryDisplayName(value) {
        const categoryNames = {
            'raw_rewards': 'Normal Items',
            'cat:normal_items': 'Normal Items',
            'cat:chests': 'Chests',
            'cat:coins': 'Coin',
            'cat:coins_no_chests': 'Coin (no chests)',
            'cat:collectibles': 'Collectibles',
            'cat:fine': 'Fine Items',
            'cat:gems': 'Gems',
            'cat:gems_fine': 'Gems (Fine)',
            'cat:if:adventurers_guild_tokens': "Adventurers' Guild Tokens",
            'cat:if:bird_nest': 'Bird Nest',
            'cat:if:crustacean': 'Crustacean',
            'cat:if:crustacean_fine': 'Crustacean (Fine)',
            'cat:if:ectoplasm': 'Ectoplasm',
            'cat:if:ectoplasm_fine': 'Ectoplasm (Fine)',
            'cat:if:fibrous_plant': 'Fibrous Plant',
            'cat:if:fibrous_plant_fine': 'Fibrous Plant (Fine)',
            'cat:if:fishing_bait': 'Fishing Bait',
            'cat:if:fishing_bait_fine': 'Fishing Bait (Fine)',
            'cat:if:gold_nugget': 'Gold Nugget',
            'cat:if:gold_nugget_fine': 'Gold Nugget (Fine)',
            'cat:if:random_gem': 'Random Gem',
            'cat:if:random_gem_fine': 'Random Gem (Fine)',
            'cat:if:random_piece_of_junk': 'Random Piece of Junk',
            'cat:if:random_piece_of_junk_fine': 'Random Piece of Junk (Fine)',
            'cat:if:skill_chest': 'Random Skill Chest',
            'cat:if:sea_shells': 'Sea Shells',
        };
        return categoryNames[value] || value;
    }

    /**
     * Get category icon from a category value or legacy item name
     */
    _getCategoryIcon(value) {
        const categoryIcons = {
            'raw_rewards': '/assets/icons/attributes/double_rewards.svg',
            'cat:normal_items': '/assets/icons/attributes/double_rewards.svg',
            'cat:chests': '/assets/icons/keywords/chest.svg',
            'cat:coins': '/assets/icons/items/coins.svg',
            'cat:coins_no_chests': '/assets/icons/items/coins.svg',
            'cat:collectibles': '/assets/icons/keywords/collectible.svg',
            'cat:fine': '/assets/icons/keywords/fine_material.svg',
            'cat:gems': '/assets/icons/keywords/gem.svg',
            'cat:gems_fine': '/assets/icons/keywords/gem.svg',
            'cat:if:adventurers_guild_tokens': "/assets/icons/items/adventurers'_guild_token.svg",
            'cat:if:bird_nest': '/assets/icons/items/containers/bird_nest.svg',
            'cat:if:crustacean': '/assets/icons/keywords/crustacean.svg',
            'cat:if:crustacean_fine': '/assets/icons/keywords/crustacean.svg',
            'cat:if:ectoplasm': '/assets/icons/items/materials/ectoplasm.svg',
            'cat:if:ectoplasm_fine': '/assets/icons/items/materials/ectoplasm.svg',
            'cat:if:fibrous_plant': '/assets/icons/keywords/fibrous_plant.svg',
            'cat:if:fibrous_plant_fine': '/assets/icons/keywords/fibrous_plant.svg',
            'cat:if:fishing_bait': '/assets/icons/keywords/fishing.svg',
            'cat:if:fishing_bait_fine': '/assets/icons/keywords/fishing.svg',
            'cat:if:gold_nugget': '/assets/icons/items/materials/gold_nugget.svg',
            'cat:if:gold_nugget_fine': '/assets/icons/items/materials/gold_nugget.svg',
            'cat:if:random_gem': '/assets/icons/keywords/gem.svg',
            'cat:if:random_gem_fine': '/assets/icons/keywords/gem.svg',
            'cat:if:random_piece_of_junk': '/assets/icons/keywords/trash.svg',
            'cat:if:random_piece_of_junk_fine': '/assets/icons/keywords/trash.svg',
            'cat:if:skill_chest': '/assets/icons/keywords/skilling_chest.svg',
            'cat:if:sea_shells': '/assets/icons/items/materials/sea_shell.svg',
        };
        return categoryIcons[value] || null;
    }

    /**
     * Get icon for current target
     */
    getTargetIcon() {
        if (this.selectedActivity) {
            // Try category icon first
            const catIcon = this._getCategoryIcon(this.targetDrop);
            if (catIcon) return catIcon;

            // Legacy: find in drop table
            if (this.dropTableData) {
                const drop = this.dropTableData.find(d =>
                    d.item_name === this.targetDrop ||
                    `${d.item_name} (Fine)` === this.targetDrop
                );
                if (drop) {
                    return this.getDropIcon(drop);
                }
            }
        }
        return null;
    }

    /**
     * Get background color for target (recipes only)
     */
    getTargetBackgroundColor() {
        if (!this.selectedRecipe) return '';

        const qualityColors = {
            'Normal': 'var(--rarity-common)',
            'Good': 'var(--rarity-uncommon)',
            'Great': 'var(--rarity-rare)',
            'Excellent': 'var(--rarity-epic)',
            'Perfect': 'var(--rarity-legendary)',
            'Eternal': 'var(--rarity-ethereal)'
        };

        return qualityColors[this.targetQuality] || '';
    }

    /**
     * Get border color for target (recipes only)
     */
    getTargetBorderColor() {
        if (!this.selectedRecipe) return '';

        const qualityBorderColors = {
            'Normal': 'var(--rarity-common-border)',
            'Good': 'var(--rarity-uncommon-border)',
            'Great': 'var(--rarity-rare-border)',
            'Excellent': 'var(--rarity-epic-border)',
            'Perfect': 'var(--rarity-legendary-border)',
            'Eternal': 'var(--rarity-ethereal-border)'
        };

        return qualityBorderColors[this.targetQuality] || '';
    }

    /**
     * Render the component
     */
    /**
     * Render inline drop rate input for fine_item/collectible targets
     */
    _renderDropRateInput() {
        if (this.targetDrop !== 'fine_item' && this.targetDrop !== 'collectible') return '';
        const label = this.targetDrop === 'fine_item'
            ? 'Estimated drop rate for base item'
            : 'Estimated drop rate for collectible';
        return `
            <div class="target-drop-rate-input" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px">
                <label style="color:var(--text-secondary);white-space:nowrap">${label}</label>
                <input type="number" class="calculator-input target-rate-input" value="${this.targetDropRate || ''}" placeholder="0" min="0" max="100" step="0.01" style="width:70px;text-align:right" />
                <span style="color:var(--text-secondary)">%</span>
            </div>
        `;
    }

    _renderEquipButtons() {
        const comparisonMode = store.state.gearsets.comparisonMode;
        if (comparisonMode) {
            return `
                <div class="equip-comparison-buttons">
                    <button class="equip-gearset-btn equip-gs1-btn">
                        Equip to Gear Set 1
                    </button>
                    <button class="equip-gearset-btn equip-gs2-btn">
                        Equip to Gear Set 2
                    </button>
                </div>
            `;
        }
        return `
            <button class="equip-gearset-btn">
                Equip Optimized Gear Set
            </button>
        `;
    }

    render() {
        if (!this.shouldShow()) {
            this.$element.html('');
            return;
        }

        // If optimization just ended (isOptimizing=false) but the cancel button
        // is still visible from a prior render, slide it up first, then re-render
        // once the animation completes. Guarded so we don't recurse.
        if (!this.isOptimizing && !this._cancelSlideOutInFlight) {
            const $cancel = this.$element.find('.cancel-optimize-btn:visible');
            if ($cancel.length) {
                this._cancelSlideOutInFlight = true;
                $cancel.slideUp(250, () => {
                    this._cancelSlideOutInFlight = false;
                    this.render();
                });
                return;
            }
        }

        const buttonText = this.isOptimizing ? 'Optimizing...' : 'Optimize Gear Set';
        const buttonClass = this.isOptimizing ? 'optimize-btn optimizing' : 'optimize-btn';
        const disabled = this.isOptimizing ? 'disabled' : '';

        // Determine if we should show target selectors
        const showTargetSelector = !this.inlineSettingsOpen && (this.selectedActivity || (this.selectedRecipe && this.isQualityRecipe()));

        // Build target selectors — one per duplicable sorting entry that has a target-related key
        let targetSelectorHtml = '';
        // Recipe and activity Quick panels are now both driven by the
        // X-per-Y priority list components. Skip the legacy
        // quality/drop selector logic entirely — all of it (target
        // dropdowns, weight sliders, etc.) is rendered by the shared
        // module in 'quick' mode. The mount point is added here and
        // hooked up post-render in `_mountXy{Recipe,Activity}QuickPanel()`.
        const useXyRecipeQuickPanel = !this.inlineSettingsOpen && !this.selectedActivity && !!this.selectedRecipe;
        // Traveling reports selectedActivity === 'traveling', so it would
        // otherwise be treated as an activity. Split it out: travel gets its
        // OWN quick mount (the 2-metric travel priority list), never the
        // activity XY panel.
        const isTravel = this.isTravelActivity();
        const useXyActivityQuickPanel = !this.inlineSettingsOpen && !!this.selectedActivity && !isTravel;
        const useTravelQuickPanel = !this.inlineSettingsOpen && isTravel;
        const useXyQuickPanel = useXyRecipeQuickPanel || useXyActivityQuickPanel || useTravelQuickPanel;
        if (useXyRecipeQuickPanel) {
            targetSelectorHtml = '<div class="xy-recipe-quick-mount" data-mount-id="optimize-button-quick"></div>';
        } else if (useXyActivityQuickPanel) {
            targetSelectorHtml = '<div class="xy-activity-quick-mount" data-mount-id="optimize-button-quick"></div>';
        } else if (useTravelQuickPanel) {
            targetSelectorHtml = '<div class="travel-quick-mount" data-mount-id="optimize-button-quick"></div>';
        }
        if (showTargetSelector && !useXyQuickPanel) {
            const settingsModal = window.settingsModal;
            const isActivity = !!this.selectedActivity;
            const sorting = isActivity
                ? (settingsModal?.activitySorting || [])
                : (settingsModal?.recipeSorting || []);

            const targetDropKeys = new Set(['steps_per_reward_roll']);
            const targetQualityKeys = new Set(['materials_for_target', 'steps_for_target', 'total_crafts']);

            // Short display names for metrics
            const metricShortNames = {
                'steps_per_reward_roll': 'Steps/Target',
                'materials_for_target': 'Materials',
                'steps_for_target': 'Steps',
                'total_crafts': 'Total Crafts'
            };

            // Collect entries that need target selectors
            const targetEntries = [];
            sorting.forEach((entry, index) => {
                const [key, weight, target] = entry;
                if (isActivity && targetDropKeys.has(key)) {
                    targetEntries.push({ index, key, target: target || 'cat:normal_items', type: 'drop' });
                } else if (!isActivity && targetQualityKeys.has(key) && this.isQualityRecipe()) {
                    targetEntries.push({ index, key, target: target || 'Perfect', type: 'quality' });
                }
            });

            // Only show target selectors the user has actually configured in their
            // Optimization Settings. If no matching priority exists, the quick
            // settings row is hidden entirely — previously a default backward-compat
            // entry was injected here which surfaced a selector even for users
            // who had removed those metrics from their priority list.

            const qualityEntries = targetEntries.filter(te => te.type === 'quality');
            const dropEntries = targetEntries.filter(te => te.type === 'drop');

            // Build selectors — group by target value for combining
            let entriesToRender = [];

            // Helper: group entries by target, create combined selectors per group
            const buildGroupedEntries = (entries, type, labelPrefix) => {
                if (entries.length === 0) return;

                const qualityKeyOptions = type === 'quality' ? Array.from(targetQualityKeys).map(k => ({
                    key: k, name: metricShortNames[k] || k
                })) : null;

                // Group by target value
                const groups = {};
                entries.forEach(te => {
                    const t = te.target;
                    if (!groups[t]) groups[t] = [];
                    groups[t].push(te);
                });

                const groupKeys = Object.keys(groups);

                for (const targetVal of groupKeys) {
                    const group = groups[targetVal];

                    // Check for duplicate keys within this group
                    const keyCounts = {};
                    group.forEach(te => { keyCounts[te.key] = (keyCounts[te.key] || 0) + 1; });
                    const hasDuplicateKeys = Object.values(keyCounts).some(c => c > 1);

                    if (!hasDuplicateKeys && group.length > 1) {
                        // Combine this group into one selector
                        const indices = group.map(te => te.index);
                        const indicesKey = 'combined-' + indices.join(',');
                        const isExpanded = this._expandedCombinedTypes && this._expandedCombinedTypes.has(indicesKey);
                        const detailLines = group.map(te => {
                            const mn = metricShortNames[te.key] || te.key;
                            return `${labelPrefix} for ${mn} (#${te.index + 1})`;
                        });

                        entriesToRender.push({
                            indices,
                            key: group[0].key,
                            target: targetVal,
                            type,
                            label: labelPrefix,
                            combined: true,
                            expanded: isExpanded,
                            detailLines,
                            duplicableKey: group[0].key,
                            rawEntries: group
                        });

                        // If expanded, push individual entries after
                        if (isExpanded) {
                            group.forEach(te => {
                                const mn = metricShortNames[te.key] || te.key;
                                let label;
                                if (type === 'quality' && qualityKeyOptions) {
                                    const opts = qualityKeyOptions.map(opt =>
                                        `<option value="${opt.key}"${opt.key === te.key ? ' selected' : ''}>${opt.name}</option>`
                                    ).join('');
                                    label = `${labelPrefix} for <select class="collapsed-metric-select" data-sort-index="${te.index}">${opts}</select> (#${te.index + 1})`;
                                } else {
                                    label = `${labelPrefix} for ${mn} (#${te.index + 1})`;
                                }
                                entriesToRender.push({
                                    indices: [te.index],
                                    key: te.key,
                                    target: te.target,
                                    type,
                                    label,
                                    combined: false,
                                    expandedFromCombined: true
                                });
                            });
                        }
                    } else if (group.length === 1 && groupKeys.length === 1) {
                        // Single entry, single group — show as combined (with duplicate button)
                        const te = group[0];
                        const mn = metricShortNames[te.key] || te.key;
                        entriesToRender.push({
                            indices: [te.index],
                            key: te.key,
                            target: te.target,
                            type,
                            label: type === 'drop' ? `${labelPrefix} for ${mn}` : labelPrefix,
                            combined: true,
                            expanded: false,
                            detailLines: [],
                            duplicableKey: te.key,
                            rawEntries: [te]
                        });
                    } else {
                        // Individual entries (duplicate keys in group, or single entry in multi-group)
                        group.forEach(te => {
                            const mn = metricShortNames[te.key] || te.key;
                            let label;
                            if (type === 'quality' && qualityKeyOptions) {
                                const opts = qualityKeyOptions.map(opt =>
                                    `<option value="${opt.key}"${opt.key === te.key ? ' selected' : ''}>${opt.name}</option>`
                                ).join('');
                                label = `${labelPrefix} for <select class="collapsed-metric-select" data-sort-index="${te.index}">${opts}</select> (#${te.index + 1})`;
                            } else {
                                label = `${labelPrefix} for ${mn} (#${te.index + 1})`;
                            }
                            entriesToRender.push({
                                indices: [te.index],
                                key: te.key,
                                target: te.target,
                                type,
                                label,
                                combined: false
                            });
                        });
                    }
                }
            };

            buildGroupedEntries(qualityEntries, 'quality', 'Target Quality');
            buildGroupedEntries(dropEntries, 'drop', 'Target Drop');

            targetSelectorHtml = entriesToRender.map(te => {
                // data-sort-indices stores comma-separated indices for combined selectors
                const indicesAttr = te.indices.join(',');
                const expandedClass = te.expandedFromCombined ? ' target-selector-expanded' : '';
                // Hide new duplicate selectors so they can slide down
                const isNewDuplicate = this._newDuplicateIndex != null && te.indices.includes(this._newDuplicateIndex);
                const hiddenStyle = isNewDuplicate ? ' style="display:none;"' : '';
                // Show X button on non-combined selectors (individual entries that can be removed)
                const removeBtn = !te.combined
                    ? `<button class="target-selector-remove" data-sort-indices="${indicesAttr}" title="Remove this priority">✕</button>`
                    : '';

                // Build (ⓘ) info icon for combined selectors showing which entries it applies to
                let combinedInfoHtml = '';
                if (te.combined && te.detailLines && te.detailLines.length > 1) {
                    const infoHtml = 'Applies to:<br>' + te.detailLines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>');
                    combinedInfoHtml = `<span class="travel-info-icon" data-info-html="${infoHtml.replace(/"/g, '&quot;')}" role="button" tabindex="0" aria-label="Applied priorities" style="font-style:normal;margin-left:4px;">ⓘ</span>`;
                }

                // For combined selectors with multiple entries: expand arrow
                // For combined selectors with single entry or individual selectors: duplicate button
                let actionBtn = '';
                if (te.combined && te.rawEntries && te.rawEntries.length > 1) {
                    // Expand arrow — uses ▼ with CSS rotation (right when collapsed, down when expanded)
                    const arrowClass = te.expanded ? 'expand-arrow expanded' : 'expand-arrow';
                    actionBtn = `<span class="collapsed-expand-btn" data-sort-indices="${indicesAttr}" title="${te.expanded ? 'Collapse' : 'Expand to edit individually'}">
                        <span class="${arrowClass}">▼</span>
                    </span>`;
                } else if (te.combined && te.duplicableKey) {
                    // Single combined entry: duplicate button
                    const lastIndex = te.indices[te.indices.length - 1];
                    actionBtn = `<button class="collapsed-duplicate-btn" data-key="${te.duplicableKey}" data-index="${lastIndex}" title="Add another with independent target">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                            <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                        </svg>
                    </button>`;
                } else if (!te.combined) {
                    // Individual entry: duplicate button
                    const lastIndex = te.indices[te.indices.length - 1];
                    actionBtn = `<button class="collapsed-duplicate-btn" data-key="${te.key}" data-index="${lastIndex}" title="Duplicate this priority">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                            <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                        </svg>
                    </button>`;
                }

                if (te.type === 'drop') {
                    const displayName = this._getCategoryDisplayName(te.target);
                    const iconPath = this._getCategoryIcon(te.target);
                    const isFine = te.target.includes('fine');
                    const iconClass = isFine ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';
                    const iconHtml = iconPath ? `<img src="${iconPath}" alt="${displayName}" class="${iconClass}" />` : '';

                    // Check if this category is valid for the current activity
                    const isValidCategory = this._isCategoryValidForActivity(te.target);

                    // Build (ⓘ) for the selected target showing items in this category
                    const categoryInfoHtml = isValidCategory ? this._buildCategoryInfoIcon(te.target) : '';

                    // Warning for invalid category
                    let warningHtml = '';
                    let invalidStyle = '';
                    if (!isValidCategory) {
                        warningHtml = `<span class="travel-info-icon" data-info="This category has no matching drops for the current activity. This priority will be skipped during optimization." role="button" tabindex="0" aria-label="Category unavailable" style="font-style:normal;color:#f1c40f;font-weight:bold;margin-right:2px;">ⓘ</span><span style="color:#f1c40f;font-weight:bold;font-size:0.85em;margin-right:4px;">N/A</span>`;
                        invalidStyle = ' style="color:#f1c40f;font-style:italic;text-decoration:line-through;"';
                    }

                    // Check if collectibles are all obtained — style the button red + italic
                    let obtainedBtnStyle = '';
                    let obtainedSuffix = '';
                    if (isValidCategory && te.target === 'cat:collectibles' && this.dropTableData) {
                        const collectibleDrops = this.dropTableData.filter(d => d.item_ref && d.item_ref.startsWith('Collectible.') && d.source !== 'equipment');
                        const allOwned = collectibleDrops.length > 0 && collectibleDrops.every(d => {
                            const itemId = d.item_name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                            return store.state.items?.[itemId]?.has || false;
                        });
                        if (allOwned) {
                            obtainedBtnStyle = ' style="color:var(--text-muted);font-style:italic;"';
                            obtainedSuffix = ' <span style="font-size:0.85em;white-space:nowrap;">(already obtained. <span style="color:#27ae60;">Nice!</span> 🎉)</span>';
                        }
                    }

                    // Use invalid style if category is invalid, otherwise use obtained style
                    const spanStyle = !isValidCategory ? invalidStyle : obtainedBtnStyle;
                    const btnStyle = !isValidCategory ? '' : obtainedBtnStyle;

                    // Checkbox: "Skip collectibles when all obtained" — green+italic when checked
                    let skipCollectiblesHtml = '';
                    if (isValidCategory && te.target === 'cat:collectibles') {
                        const skipEnabled = window.settingsModal?.skipObtainedCollectibles || false;
                        const skipChecked = skipEnabled ? 'checked' : '';
                        const labelStyle = skipEnabled
                            ? 'color:#27ae60;font-style:italic;'
                            : 'color:var(--text-muted);';
                        skipCollectiblesHtml = `
                            <label class="optimizer-checkbox skip-collectibles-checkbox" style="margin-top:6px;font-size:0.85em;display:flex;align-items:center;gap:6px;">
                                <input type="checkbox" class="skip-obtained-collectibles" ${skipChecked} />
                                <span class="optimizer-checkbox-label" style="${labelStyle}font-weight:600;">Skip collectibles when all obtained</span>
                            </label>
                        `;
                    }

                    const dropdownHiddenStyle = te.expanded ? ' style="display:none;"' : '';
                    return `
                        <div class="target-selector${expandedClass}" data-sort-indices="${indicesAttr}"${hiddenStyle}>
                            <div class="target-label-row">
                                <div class="target-label">${te.label}${combinedInfoHtml}</div>
                                ${actionBtn}${removeBtn}
                            </div>
                            <div class="combined-dropdown-content"${dropdownHiddenStyle}>
                                ${skipCollectiblesHtml}
                                <div class="target-dropdown-button"${btnStyle}>
                                    <div class="target-dropdown-value">
                                        ${warningHtml}${iconHtml}
                                        <span${spanStyle}>${displayName}${obtainedSuffix} ${categoryInfoHtml}</span>
                                    </div>
                                    <button class="target-dropdown-toggle">
                                        <span class="expand-arrow">▼</span>
                                    </button>
                                </div>
                                <div class="target-dropdown" style="display: none;"></div>
                            </div>
                        </div>
                    `;
                } else {
                    // Quality
                    const qualityColors = {
                        'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)',
                        'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)',
                        'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)'
                    };
                    const qualityBorders = {
                        'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)',
                        'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)',
                        'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)'
                    };
                    const bgColor = qualityColors[te.target] || '';
                    const borderColor = qualityBorders[te.target] || '';
                    const btnStyle = (bgColor && borderColor) ? `background: ${bgColor}; border: 2px solid ${borderColor};` : '';

                    const dropdownHiddenStyle = te.expanded ? ' style="display:none;"' : '';
                    return `
                        <div class="target-selector${expandedClass}" data-sort-indices="${indicesAttr}"${hiddenStyle}>
                            <div class="target-label-row">
                                <div class="target-label">${te.label}${combinedInfoHtml}</div>
                                ${actionBtn}${removeBtn}
                            </div>
                            <div class="combined-dropdown-content"${dropdownHiddenStyle}>
                                <div class="target-dropdown-button" style="${btnStyle}">
                                    <div class="target-dropdown-value">
                                        <span>${te.target}</span>
                                    </div>
                                    <button class="target-dropdown-toggle">
                                        <span class="expand-arrow">▼</span>
                                    </button>
                                </div>
                                <div class="target-dropdown" style="display: none;"></div>
                            </div>
                        </div>
                    `;
                }
            }).join('');
        }

        // Budget inputs. For recipe mode, budget now lives inside the
        // X-per-Y priority list as a first-class entry (handled by the mount
        // below), so we skip the separate budget section. Activity mode
        // never had a budget section — this block is a no-op there too.
        let budgetHtml = '';
        if (this.selectedRecipe && !this.inlineSettingsOpen && !useXyQuickPanel) {
            const settingsModal = window.settingsModal;
            const recipeSorting = settingsModal?.recipeSorting || [];
            const hasBudgetSort = recipeSorting.some(entry => Array.isArray(entry) && entry[0] === 'steps_for_budget');
            if (hasBudgetSort) {
                budgetHtml = `
                <div class="budget-section" style="margin-top: 10px; margin-bottom: 8px;">
                    <div class="calculator-label" style="margin-bottom: 6px;">Budget Optimization</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <div class="calculator-input-group" style="width: 45%; min-width: 0;">
                            <label class="calculator-label" style="font-size: 0.8em; text-transform: none; letter-spacing: 0;">Input Materials</label>
                            <input type="number" class="calculator-input budget-materials-input" value="${this.budgetMaterials || ''}" placeholder="0" min="0" />
                        </div>
                        <div class="calculator-input-group" style="width: 45%; min-width: 0;">
                            <label class="calculator-label" style="font-size: 0.8em; text-transform: none; letter-spacing: 0;">Target Output</label>
                            <input type="number" class="calculator-input budget-target-input" value="${this.budgetTarget || ''}" placeholder="0" min="0" />
                        </div>
                    </div>
                </div>
            `;
            }
        }

        // Quick Optimization Settings — collapsible header (hidden entirely when collapsed)
        const quickSettingsCollapsed = localStorage.getItem('quickOptSettingsCollapsed') === 'true';
        const instantActionsHtml = this._renderInstantActionsCheckbox('quick');
        const hasQuickSettings = targetSelectorHtml || budgetHtml || instantActionsHtml;
        // Info popover explaining the eye and edit icons on each
        // priority entry. Uses the same travel-info-icon widget as the
        // per-entry info popovers so it picks up wireInfoIcons styling.
        const eyeIconInline = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const pencilIconInline = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        const quickHeaderInfoHtml = [
            '<div style="line-height:1.4;max-width:320px;">',
            `<p style="margin:0 0 8px 0;"><strong>${eyeIconInline} Eye</strong> &mdash; toggles whether a priority shows up here in Quick. Hide priorities you rarely change to keep Quick tidy; unhide them from the Detailed panel (gear icon).</p>`,
            `<p style="margin:0;"><strong>${pencilIconInline} Edit</strong> &mdash; collapses a priority into a compact label, hiding the X/Y dropdowns so only the target/quality stays editable. The <em>Edit all</em> button here flips every priority at once.</p>`,
            '</div>',
        ].join('');
        const quickHeaderInfoEscaped = quickHeaderInfoHtml.replace(/"/g, '&quot;');
        // Travel gets its own (i) explanation (2 metrics, no eye/edit icons).
        const travelHeaderInfoHtml = [
            '<div style="line-height:1.4;max-width:300px;">',
            '<p style="margin:0 0 6px 0;"><strong>Total Steps</strong> &mdash; minimize the raw steps to walk the route.</p>',
            '<p style="margin:0;"><strong>Steps / Target Item</strong> &mdash; instead prioritize finding a chosen item (a chest or an item-finding drop) while traveling. Add one with <strong>+</strong>, pick its target, and tune weights in the gear ⚙ Detailed panel.</p>',
            '</div>',
        ].join('');
        const travelHeaderInfoEscaped = travelHeaderInfoHtml.replace(/"/g, '&quot;');
        // The info popover explains the Eye/Edit icons on XY priority entries,
        // which appear for both recipe and activity Quick panels (both use
        // the XY component now). Hide the ⓘ when neither is selected.
        const showQuickHeaderInfo = ((!!this.selectedRecipe && !this.selectedActivity)
            || !!this.selectedActivity) && !isTravel;
        // Travel shows the (i) + "+" too, but with travel wiring (no XY edit-all).
        const showTravelHeader = isTravel && !!targetSelectorHtml;
        const quickHeaderInfoSpan = showQuickHeaderInfo
            ? `<span class="quick-opt-header-info travel-info-icon"
                  data-info-html="${quickHeaderInfoEscaped}"
                  role="button" tabindex="0" aria-label="What do these icons do?">ⓘ</span>`
            : (showTravelHeader
                ? `<span class="quick-opt-header-info travel-info-icon"
                      data-info-html="${travelHeaderInfoEscaped}"
                      role="button" tabindex="0" aria-label="What do these travel priorities do?">ⓘ</span>`
                : '');
        // "+" button: expands the Quick panel (if collapsed) and inserts
        // a new priority at index 0. Mirrors the "+ Add priority #1"
        // empty-state button so users don't have to open Detailed
        // settings to add a top-priority entry. Recipe-only — same
        // visibility gate as the (i) info popover.
        const quickHeaderAddBtn = showQuickHeaderInfo
            ? `<button type="button"
                  class="quick-opt-header-add-btn"
                  title="Add a new optimization priority as #1"
                  aria-label="Add priority as #1">+</button>`
            : (showTravelHeader
                ? `<button type="button"
                      class="quick-opt-header-add-btn quick-opt-header-add-btn-travel"
                      title="Add a Steps / Target Item priority as #1"
                      aria-label="Add travel priority as #1">+</button>`
                : '');
        const quickHeaderExtras = showTravelHeader
            ? `
            ${quickHeaderAddBtn}
            ${quickHeaderInfoSpan}
        `
            : `
            ${quickHeaderAddBtn}
            ${quickHeaderInfoSpan}
            <div class="quick-opt-edit-bar-slot" data-slot="xy-global-edit"></div>
        `;
        let quickSettingsHtml = '';
        if (hasQuickSettings && !this.inlineSettingsOpen && !quickSettingsCollapsed) {
            quickSettingsHtml = `
                <div class="quick-opt-settings-header">
                    <span class="expand-arrow expanded">▼</span>
                    <span class="quick-opt-settings-title">Quick Optimization Settings</span>
                    ${quickHeaderExtras}
                </div>
                <div class="quick-opt-settings-content">
                    ${targetSelectorHtml}
                    ${budgetHtml}
                    ${this._renderInstantActionsCheckbox('quick')}
                    ${this._renderRunLocalCheckbox()}
                </div>
            `;
        } else if (hasQuickSettings && !this.inlineSettingsOpen && quickSettingsCollapsed) {
            // Just show the collapsed header to allow re-expanding
            quickSettingsHtml = `
                <div class="quick-opt-settings-header">
                    <span class="expand-arrow">▼</span>
                    <span class="quick-opt-settings-title">Quick Optimization Settings</span>
                    ${quickHeaderExtras}
                </div>
                <div class="quick-opt-settings-content" style="display:none;">
                    ${targetSelectorHtml}
                    ${budgetHtml}
                    ${this._renderInstantActionsCheckbox('quick')}
                    ${this._renderRunLocalCheckbox()}
                </div>
            `;
        }

        const html = `
            <div class="optimize-container">
                ${quickSettingsHtml}

                ${(store.state.gearsets?.comparisonMode && !isTravel) ? `
                <div class="optimize-comparison-buttons" data-pin-id="optimize-comparison-buttons">
                    <button class="optimize-btn optimize-gs1-btn" data-pin-id="optimize-button-gs1" ${disabled}>
                        ${this.isOptimizing && this._optimizingSlot === 1 ? '<span class="spinner">⏳</span>' : ''}
                        Optimize Set 1
                    </button>
                    <button class="optimize-btn optimize-gs2-btn" data-pin-id="optimize-button-gs2" ${disabled}>
                        ${this.isOptimizing && this._optimizingSlot === 2 ? '<span class="spinner">⏳</span>' : ''}
                        Optimize Set 2
                    </button>
                    <div class="optimize-settings-icon ${this.inlineSettingsOpen ? 'settings-open' : ''}" title="Optimization settings">
                        <svg class="optimize-gear-svg" viewBox="0 0 24 24"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" /></svg>
                    </div>
                </div>
                ` : `
                <div class="optimize-button-row" data-pin-id="optimize-button-row">
                    <button class="${isTravel ? ('travel-optimize-btn' + (this.isOptimizing ? ' optimizing' : '')) : buttonClass}" data-pin-id="${isTravel ? 'travel-optimize-button' : 'optimize-button'}" ${disabled}>
                        ${this.isOptimizing ? '<span class="spinner">⏳</span>' : ''}
                        ${buttonText}
                    </button>
                    <div class="optimize-settings-icon ${this.inlineSettingsOpen ? 'settings-open' : ''}" title="Optimization settings">
                        <svg class="optimize-gear-svg" viewBox="0 0 24 24"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" /></svg>
                    </div>
                </div>
                `}

                <!-- Cancel Button (shown only while optimization is running) -->
                ${this.isOptimizing ? '<button class="cancel-optimize-btn" data-pin-id="cancel-optimize-button">Cancel Optimization</button>' : ''}
                
                <!-- Equip Button (shown after optimization completes) -->
                ${this.showEquipButton ? this._renderEquipButtons() : ''}
            </div>
        `;

        this.$element.html(html);

        // Slide down equip button if it just appeared
        if (this.showEquipButton) {
            const $equipBtns = this.$element.find('.equip-gearset-btn, .equip-comparison-buttons');
            $equipBtns.hide().slideDown(300);
        }

        // Mount the X-per-Y Quick panel for recipe mode (if present).
        this._mountXyRecipeQuickPanel();
        // Mount the X-per-Y Quick panel for activity mode (if present).
        this._mountXyActivityQuickPanel();
        // Mount the travel Quick panel (if present).
        this._mountTravelQuickPanel();

        // Slide down the cancel button when optimization starts
        if (this.isOptimizing) {
            const $cancel = this.$element.find('.cancel-optimize-btn');
            if ($cancel.length) $cancel.hide().slideDown(250);
        }

        // Re-render inline settings panel if it was open (e.g. on page load when
        // the panel is persisted to localStorage as open). Wrap panel + "Open Global"
        // button in an .inline-opt-wrapper so they animate together.
        if (this.inlineSettingsOpen && !this.isOptimizing) {
            this._renderInlineSettings();
            const $panel = this.$element.find('.inline-opt-settings');
            if ($panel.length && !$panel.closest('.inline-opt-wrapper').length) {
                const $wrapper = $('<div class="inline-opt-wrapper"></div>');
                const $globalBtn = $('<button class="open-global-opt-settings-btn" title="Open the full optimization settings in the Settings modal">Open Global Optimization Settings</button>');
                // Instant-actions checkbox goes between the optimize button and the global settings button
                const instantActionsHtmlInline = this._renderInstantActionsCheckbox('inline');
                const $instantActions = instantActionsHtmlInline ? $(instantActionsHtmlInline) : null;
                $panel.before($wrapper);
                if ($instantActions) $wrapper.append($instantActions);
                $wrapper.append($globalBtn);
                $wrapper.append($panel);
            }
        }

        // Slide down newly duplicated selector
        if (this._newDuplicateIndex != null) {
            const newIdx = this._newDuplicateIndex;
            // Use requestAnimationFrame to ensure DOM is painted before animating
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.$element.find('.target-selector').each(function () {
                        const indices = String($(this).data('sort-indices') || '').split(',').map(Number);
                        if (indices.includes(newIdx)) {
                            $(this).slideDown(300);
                        }
                    });
                });
            });
        }

        this.attachEvents();
    }

    /**
     * Decode gearset export string
     * @param {string} exportString - Base64 encoded gzip compressed JSON
     * @returns {Object} Decoded gearset data
     */
    decodeGearset(exportString) {
        try {
            // Base64 decode
            const binaryString = atob(exportString);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Gunzip
            const decompressed = pako.ungzip(bytes, { to: 'string' });

            // Parse JSON
            return JSON.parse(decompressed);
        } catch (error) {
            console.error('Failed to decode gearset:', error);
            return null;
        }
    }

    /**
     * Decode gearset export string and apply to current gear
     * @param {string} exportString - Base64 encoded gzip compressed JSON
     */
    async decodeAndApplyGearset(exportString) {
        try {
            // Decode the gearset export string
            const decoded = this.decodeGearset(exportString);

            if (!decoded || !decoded.items) {
                throw new Error('Invalid gearset export');
            }

            // Convert to slot format and apply to state
            const slots = {};

            for (const item of decoded.items) {
                const slotName = item.type;
                const itemData = JSON.parse(item.item);

                // Map slot names (handle tool0-5, ring1-2)
                let finalSlotName = slotName;
                if (slotName === 'tool') {
                    finalSlotName = `tool${item.index} `;
                } else if (slotName === 'ring') {
                    finalSlotName = `ring${item.index + 1} `;
                }

                slots[finalSlotName] = {
                    itemId: itemData.id,
                    quality: itemData.quality || null
                };
            }

            // Update state (this will trigger gear slot grid to render with full item objects)
            if (!store.state.column2) {
                store.state.column2 = {};
            }
            store.state.column2.gearSlots = slots;

            // Notify subscribers
            store._notifySubscribers('column2.gearSlots');

            console.log('Applied gearset:', slots);

        } catch (error) {
            console.error('Failed to apply gearset:', error);
            throw error;
        }
    }

    /**
     * Equip the optimized gear set
     */
    async equipOptimizedGearset() {
        if (!this.optimizedGearsetId) return;

        console.log('Equipping optimized gearset:', this.optimizedGearsetId);

        // Slide up the button first
        const $equipBtn = this.$element.find('.equip-gearset-btn');
        $equipBtn.slideUp(300);

        // Load the gearset (this will update the state and trigger gear slot updates)
        store.loadGearSet(this.optimizedGearsetId);

        // Hide the button after animation
        setTimeout(() => {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
            this.render();
        }, 300);
    }

    async equipOptimizedToSlot2() {
        if (!this.optimizedGearsetId) return;

        console.log('Equipping optimized gearset to slot 2:', this.optimizedGearsetId);

        // Slide up the buttons
        const $btns = this.$element.find('.equip-comparison-buttons');
        $btns.slideUp(300);

        // Load into gearset 2
        store.loadGearSetToSlot2(this.optimizedGearsetId);

        // Hide buttons after animation
        setTimeout(() => {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
            this.render();
        }, 300);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        this.$element.off('click');

        // "Run optimization locally" (quick-settings) — mirrors the global
        // setting (window.settingsModal.runLocalOptimization), synced with the
        // settings modal + goals report. Namespaced + off so re-running
        // attachEvents (on every render) can't stack duplicate handlers on the
        // persistent $element.
        this.$element.off('change.optRunLocal').on('change.optRunLocal', '.opt-run-local-checkbox', (e) => {
            const checked = e.target.checked;
            if (window.settingsModal) {
                window.settingsModal.runLocalOptimization = checked;
                try { window.settingsModal.saveGlobalOptimizationSettings(); } catch (_) { /* non-fatal */ }
            }
            try {
                window.dispatchEvent(new CustomEvent('runLocalOptimizationChanged', { detail: { enabled: checked } }));
            } catch (_) { /* non-fatal */ }
        });
        this.$element.find('.opt-run-local-row').each((_, el) => { try { wireInfoIcons(el); } catch (e) { /* ignore */ } });

        // Instant-actions checkbox — sync both panels and persist to session
        this.$element.on('change', '.instant-actions-checkbox', async (e) => {
            const $cb = $(e.currentTarget);
            const skillType = $cb.data('skill');
            const checked = $cb.prop('checked');

            // Update state — smithing and smelting both map to the Tortoise state
            if (skillType === 'foraging') {
                this.instantActionsForaging = checked;
            } else if (skillType === 'smithing' || skillType === 'smelting') {
                this.instantActionsSmelting = checked;
            }

            // Update store.state.ui so re-renders pick up the new value
            if (!store.state.ui) store.state.ui = {};
            // Store under the canonical key for this pet's skill
            const stateKey = (skillType === 'foraging') ? 'instant_actions_foraging' : 'instant_actions_smelting';
            store.state.ui[stateKey] = checked;
            // Notify subscribers so activity-info and drops sections re-render
            store._notifySubscribers(`ui.${stateKey}`);

            // Sync the other checkbox instance (quick ↔ inline)
            this.$element.find(`.instant-actions-checkbox[data-skill="${skillType}"]`).prop('checked', checked);

            // Persist to session — use canonical key
            const persistKey = `ui.${stateKey}`;
            const uuid = store.state.session?.uuid;
            if (uuid) {
                try {
                    await api.updateConfig(uuid, persistKey, checked);
                } catch (err) {
                    console.warn('[InstantActions] Failed to persist state:', err);
                }
            }
        });

        // Ability-stats pet checkbox (e.g. Tiger "The Hunt Is On" for Hunting)
        // — sync both panels and persist per-skill to session.
        this.$element.on('change', '.ability-stats-checkbox', async (e) => {
            const $cb = $(e.currentTarget);
            const skillType = $cb.data('skill');
            const checked = $cb.prop('checked');

            // Update store.state.ui so re-renders pick up the new value
            if (!store.state.ui) store.state.ui = {};
            const stateKey = `ability_stats_${skillType}`;
            store.state.ui[stateKey] = checked;
            // Notify subscribers so activity-info and drops sections re-render
            store._notifySubscribers(`ui.${stateKey}`);

            // Sync the other checkbox instance (quick ↔ inline)
            this.$element.find(`.ability-stats-checkbox[data-skill="${skillType}"]`).prop('checked', checked);

            // Persist to session
            const uuid = store.state.session?.uuid;
            if (uuid) {
                try {
                    await api.updateConfig(uuid, `ui.${stateKey}`, checked);
                } catch (err) {
                    console.warn('[AbilityStats] Failed to persist state:', err);
                }
            }
        });

        // Quick Optimization Settings header toggle
        this.$element.on('click', '.quick-opt-settings-header', (e) => {
            // Ignore clicks on the (i) info icon, the "+" add-priority
            // button, and the edit-button slot embedded in the header —
            // those have their own handlers and shouldn't collapse the
            // whole Quick panel.
            const $tgt = $(e.target);
            if (
                $tgt.closest('.quick-opt-header-info').length ||
                $tgt.closest('.quick-opt-header-add-btn').length ||
                $tgt.closest('.quick-opt-edit-bar-slot').length ||
                $tgt.closest('.travel-info-popover').length
            ) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const $content = this.$element.find('.quick-opt-settings-content');
            const $arrow = $(e.currentTarget).find('.expand-arrow');
            if ($content.is(':visible')) {
                $arrow.removeClass('expanded');
                $content.slideUp(200);
                localStorage.setItem('quickOptSettingsCollapsed', 'true');
            } else {
                $arrow.addClass('expanded');
                $content.slideDown(200);
                localStorage.setItem('quickOptSettingsCollapsed', 'false');
            }
        });

        // Quick Optimization Settings "+" button — expand the panel
        // if collapsed, then insert a new priority at #1. The mount
        // point and the controller already exist when the panel is
        // collapsed (the content is in the DOM but display:none), so
        // we can call addPriorityFirst() unconditionally.
        //
        // Dispatches to the recipe or activity controller based on
        // current selection. Both controllers expose addPriorityFirst()
        // — recipe defaults to (materials, quality|craft), activity
        // defaults to (steps, action).
        this.$element.on('click', '.quick-opt-header-add-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $content = this.$element.find('.quick-opt-settings-content');
            const $arrow = this.$element.find('.quick-opt-settings-header .expand-arrow').first();
            if (!$content.is(':visible')) {
                $arrow.addClass('expanded');
                $content.slideDown(200);
                localStorage.setItem('quickOptSettingsCollapsed', 'false');
            }
            const ctrl = this.isTravelActivity()
                ? this._travelQuickController
                : (this.selectedActivity
                    ? this._xyActivityQuickController
                    : this._xyQuickController);
            if (ctrl && typeof ctrl.addPriorityFirst === 'function') {
                ctrl.addPriorityFirst();
            }
        });

        // Travel optimize button
        this.$element.on('click', '.travel-optimize-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.isOptimizing) {
                this.optimizeTravel();
            }
        });

        // Open Global Optimization Settings button — keeps inline panel open
        this.$element.on('click', '.open-global-opt-settings-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Open the settings modal on the Optimization tab (don't close inline panel)
            if (window.settingsModal) {
                window.settingsModal.show('optimization');
            }
        });

        // Optimize button click
        this.$element.on('click', '.optimize-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.isOptimizing && !$(e.target).closest('.optimize-settings-icon').length) {
                // Wrap the optimize kick-off in a try/catch that surfaces
                // the real error to the user AND to the error buffer
                // picked up by the next bug report. Without this, a JS
                // exception during click handling silently leaves the
                // button in a "nothing happens" state, which is what the
                // "cannot optimize for crafts" bug report was about.
                try {
                    const $btn = $(e.currentTarget);
                    if ($btn.hasClass('optimize-gs1-btn')) {
                        this.optimize(1);
                    } else if ($btn.hasClass('optimize-gs2-btn')) {
                        this.optimize(2);
                    } else {
                        this.optimize();
                    }
                } catch (err) {
                    console.error('[optimize-click]', err);
                    if (window.__walkscapeRecordError) {
                        window.__walkscapeRecordError('optimize-click', err);
                    }
                    if (window.api && window.api.showError) {
                        window.api.showError('Optimize click threw: ' + (err?.message || err));
                    }
                    // Reset optimizing flag so subsequent clicks aren't
                    // stuck believing an optimization is already running.
                    this.isOptimizing = false;
                    try { this.render(); } catch (_e) { /* noop */ }
                }
            }
        });

        // Cancel optimization button click — two-click same-button confirm.
        // First click: arm the button (swap text, add .confirm-pending, start revert timer).
        // Second click within 3s: actually cancel.
        this.$element.on('click', '.cancel-optimize-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.isOptimizing) return;

            const $btn = $(e.currentTarget);

            if ($btn.hasClass('confirm-pending')) {
                // Second click — cancel for real
                if (this._cancelRevertTimer) {
                    clearTimeout(this._cancelRevertTimer);
                    this._cancelRevertTimer = null;
                }
                this.cancelOptimization();
                return;
            }

            // First click — arm and start revert timer
            $btn.addClass('confirm-pending').text('Click again to confirm cancel');
            this._cancelRevertTimer = setTimeout(() => {
                // Reset if the user didn't confirm in time
                this.$element
                    .find('.cancel-optimize-btn.confirm-pending')
                    .removeClass('confirm-pending')
                    .text('Cancel Optimization');
                this._cancelRevertTimer = null;
            }, 3000);
        });

        // Settings icon click
        this.$element.on('click', '.optimize-settings-icon', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openOptimizationSettings();
        });

        // Equip gearset button click
        this.$element.on('click', '.equip-gearset-btn:not(.equip-gs1-btn):not(.equip-gs2-btn)', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.equipOptimizedGearset();
        });

        // Equip to Gear Set 1 (comparison mode)
        this.$element.on('click', '.equip-gs1-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.equipOptimizedGearset();  // Equip to current (gear set 1)
        });

        // Equip to Gear Set 2 (comparison mode)
        this.$element.on('click', '.equip-gs2-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.equipOptimizedToSlot2();
        });

        // Expand arrow in combined collapsed view — expands to show individual entries with slide
        this.$element.on('click', '.collapsed-expand-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this._expandedCombinedTypes) this._expandedCombinedTypes = new Set();
            const $selector = $(e.currentTarget).closest('.target-selector');
            const indicesStr = $selector.data('sort-indices');
            const groupKey = 'combined-' + indicesStr;
            const $arrow = $(e.currentTarget).find('.expand-arrow');
            const $dropdownContent = $selector.find('.combined-dropdown-content');

            if (this._expandedCombinedTypes.has(groupKey)) {
                // Collapse: slide up expanded entries AND slide down the main dropdown
                this._expandedCombinedTypes.delete(groupKey);
                const $expanded = $selector.nextUntil(':not(.target-selector-expanded)');
                $arrow.removeClass('expanded');
                $expanded.slideUp(200);
                $dropdownContent.slideDown(200);
                // Clean up after animations
                setTimeout(() => { this.render(); }, 250);
            } else {
                // Expand: slide up dropdown AND slide down individual entries simultaneously
                this._expandedCombinedTypes.add(groupKey);
                $arrow.addClass('expanded');
                this._skipSettingsRerender = true;

                // Build expanded entries HTML from sorting data
                const settingsModal = window.settingsModal;
                const isActivity = !!this.selectedActivity;
                const sorting = isActivity ? settingsModal?.activitySorting : settingsModal?.recipeSorting;
                const indices = String(indicesStr).split(',').map(Number);
                const targetQualityKeys = new Set(['materials_for_target', 'steps_for_target', 'total_crafts']);
                const metricShortNames = { 'steps_per_reward_roll': 'Steps/Target', 'materials_for_target': 'Materials', 'steps_for_target': 'Steps', 'total_crafts': 'Total Crafts' };

                let expandedHtml = '';
                indices.forEach(idx => {
                    if (!sorting || idx >= sorting.length) return;
                    const entry = sorting[idx];
                    const key = entry[0];
                    const target = entry[2];
                    const metricName = metricShortNames[key] || key;
                    const dupSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect><path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path></svg>';
                    const dupBtn = '<button class="collapsed-duplicate-btn" data-key="' + key + '" data-index="' + idx + '" title="Duplicate">' + dupSvg + '</button>';
                    const removeBtn = '<button class="target-selector-remove" data-sort-indices="' + idx + '" title="Remove">✕</button>';

                    if (isActivity) {
                        const dt = target || 'cat:normal_items';
                        const dn = this._getCategoryDisplayName(dt);
                        const ip = this._getCategoryIcon(dt);
                        const isFine = dt.includes('fine');
                        const ic = isFine ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';
                        const ih = ip ? '<img src="' + ip + '" alt="' + dn + '" class="' + ic + '" />' : '';
                        const iv = this._isCategoryValidForActivity(dt);
                        const ci = iv ? this._buildCategoryInfoIcon(dt) : '';
                        let wh = '', is = '';
                        if (!iv) {
                            wh = '<span class="travel-info-icon" data-info="No matching drops for this activity." role="button" tabindex="0" style="font-style:normal;color:#f1c40f;font-weight:bold;margin-right:2px;">ⓘ</span><span style="color:#f1c40f;font-weight:bold;font-size:0.85em;margin-right:4px;">N/A</span>';
                            is = ' style="color:#f1c40f;font-style:italic;text-decoration:line-through;"';
                        }
                        expandedHtml += '<div class="target-selector target-selector-expanded" data-sort-indices="' + idx + '" style="display:none;">' +
                            '<div class="target-label-row"><div class="target-label">Target Drop for ' + metricName + ' (#' + (idx + 1) + ')</div>' + dupBtn + removeBtn + '</div>' +
                            '<div class="target-dropdown-button"><div class="target-dropdown-value">' + wh + ih + '<span' + is + '>' + dn + ' ' + ci + '</span></div>' +
                            '<button class="target-dropdown-toggle"><span class="expand-arrow">▼</span></button></div>' +
                            '<div class="target-dropdown" style="display:none;"></div></div>';
                    } else {
                        const dq = target || 'Perfect';
                        const qc = { 'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)', 'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)', 'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)' };
                        const qb = { 'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)', 'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)', 'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)' };
                        const bs = (qc[dq] && qb[dq]) ? 'background:' + qc[dq] + ';border:2px solid ' + qb[dq] + ';' : '';
                        const qko = Array.from(targetQualityKeys).map(k => '<option value="' + k + '"' + (k === key ? ' selected' : '') + '>' + (metricShortNames[k] || k) + '</option>').join('');
                        const ms = '<select class="collapsed-metric-select" data-sort-index="' + idx + '">' + qko + '</select>';
                        expandedHtml += '<div class="target-selector target-selector-expanded" data-sort-indices="' + idx + '" style="display:none;">' +
                            '<div class="target-label-row"><div class="target-label">Target Quality for ' + ms + ' (#' + (idx + 1) + ')</div>' + dupBtn + removeBtn + '</div>' +
                            '<div class="target-dropdown-button" style="' + bs + '"><div class="target-dropdown-value"><span>' + dq + '</span></div>' +
                            '<button class="target-dropdown-toggle"><span class="expand-arrow">▼</span></button></div>' +
                            '<div class="target-dropdown" style="display:none;"></div></div>';
                    }
                });

                // Insert and animate simultaneously
                if (expandedHtml) {
                    $selector.after(expandedHtml);
                    this.$element.find('.target-selector-expanded').each(function () { wireInfoIcons(this); });
                }
                $dropdownContent.slideUp(250);
                this.$element.find('.target-selector-expanded').slideDown(250);
                setTimeout(() => { this._skipSettingsRerender = false; }, 400);
            }
        });

        // Duplicate button in collapsed view — adds a new sorting entry with same key
        this.$element.on('click', '.collapsed-duplicate-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const key = $btn.data('key');
            const index = parseInt($btn.data('index'), 10);

            const settingsModal = window.settingsModal;
            if (!settingsModal) return;

            const isActivity = !!this.selectedActivity;
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
            const existingTarget = sorting[index] ? sorting[index][2] || null : null;
            const weight = sorting[index] ? sorting[index][1] : 100;
            const newIndex = index + 1;

            sorting.splice(newIndex, 0, [key, weight, existingTarget]);
            settingsModal.saveOptimizationSettings();

            // Mark which index is new so we can animate it after render
            // Also skip the settings-loaded re-render since we handle our own
            this._newDuplicateIndex = newIndex;
            this._skipSettingsRerender = true;
            this.render();
            this._newDuplicateIndex = null;
            // Clear the skip flag after the animation completes
            setTimeout(() => { this._skipSettingsRerender = false; }, 400);
        });

        // Metric select dropdown in collapsed view — changes the sorting key for that entry
        this.$element.on('change', '.collapsed-metric-select', (e) => {
            e.stopPropagation();
            const $select = $(e.currentTarget);
            const newKey = $select.val();
            const sortIndex = parseInt($select.data('sort-index'), 10);

            const settingsModal = window.settingsModal;
            if (!settingsModal) return;

            const isActivity = !!this.selectedActivity;
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;

            if (sortIndex >= 0 && sortIndex < sorting.length) {
                sorting[sortIndex][0] = newKey;
                settingsModal.saveOptimizationSettings();
                this.render();
            }
        });

        // Remove target selector (X button) — removes the sorting entry with slide animation
        this.$element.on('click', '.target-selector-remove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const indicesStr = $btn.data('sort-indices');
            if (indicesStr === undefined || indicesStr === '') return;

            const indices = String(indicesStr).split(',').map(Number).sort((a, b) => b - a); // Sort descending for safe splice
            const settingsModal = window.settingsModal;
            if (!settingsModal) return;

            const isActivity = !!this.selectedActivity;
            const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;

            // Don't allow removing if it would leave zero entries
            if (sorting.length <= indices.length) return;

            // Slide up the selector, then update data and re-render
            const $selector = $btn.closest('.target-selector');
            this._skipSettingsRerender = true;
            $selector.slideUp(200, () => {
                for (const idx of indices) {
                    if (idx >= 0 && idx < sorting.length) {
                        sorting.splice(idx, 1);
                    }
                }
                settingsModal.saveOptimizationSettings();
                this.render();
                setTimeout(() => { this._skipSettingsRerender = false; }, 400);
            });
        });

        // Target dropdown toggle (exclude inline panel — it has its own handlers)
        this.$element.on('click', '.target-dropdown-toggle, .target-dropdown-button', (e) => {
            if ($(e.target).closest('.inline-opt-settings').length) return;
            e.preventDefault();
            e.stopPropagation();

            const $selector = $(e.target).closest('.target-selector');
            const $dropdown = $selector.find('.target-dropdown');
            // Only toggle the arrow inside .target-dropdown-toggle, not any other
            // .expand-arrow in the selector (e.g. .collapsed-expand-btn's arrow).
            const $arrow = $selector.find('.target-dropdown-toggle .expand-arrow');

            // Close other open dropdowns
            this.$element.find('.target-selector').not($selector).find('.target-dropdown:visible').slideUp(200);
            this.$element.find('.target-selector').not($selector).find('.target-dropdown-toggle .expand-arrow.expanded').removeClass('expanded');

            if ($dropdown.is(':visible')) {
                $arrow.removeClass('expanded');
                $dropdown.slideUp(200);
            } else {
                $dropdown.html(this.renderTargetDropdownContent());
                wireInfoIcons($dropdown[0]);
                $arrow.addClass('expanded');
                $dropdown.slideDown(200);
            }
        });

        // Target item selection (exclude inline panel) — slide up dropdown then update
        this.$element.on('click', '.target-item', (e) => {
            if ($(e.target).closest('.inline-opt-settings').length) return;
            e.preventDefault();
            e.stopPropagation();
            const value = $(e.currentTarget).data('value');
            const $selector = $(e.currentTarget).closest('.target-selector');
            const $dropdown = $selector.find('.target-dropdown');
            const $arrow = $selector.find('.target-dropdown-toggle .expand-arrow');
            const indicesStr = $selector.data('sort-indices');

            // Update the per-entry target in the sorting data
            const settingsModal = window.settingsModal;
            if (settingsModal && indicesStr !== undefined && indicesStr !== '') {
                const indices = String(indicesStr).split(',').map(Number);
                const isActivity = !!this.selectedActivity;
                const sorting = isActivity ? settingsModal.activitySorting : settingsModal.recipeSorting;
                for (const idx of indices) {
                    if (idx >= 0 && idx < sorting.length) {
                        sorting[idx][2] = value;
                    }
                }
                settingsModal.saveOptimizationSettings();
            }

            // Slide up the dropdown, then re-render
            $arrow.removeClass('expanded');
            this._skipSettingsRerender = true;
            if ($dropdown.is(':visible') && $dropdown.height() > 0) {
                $dropdown.slideUp(250, () => {
                    this.render();
                    setTimeout(() => { this._skipSettingsRerender = false; }, 100);
                });
            } else {
                this.render();
                setTimeout(() => { this._skipSettingsRerender = false; }, 100);
            }
        });

        // Click outside to close dropdown
        $(document).on('click.target-dropdown', (e) => {
            if (!$(e.target).closest('.target-selector').length) {
                this.$element.find('.target-dropdown:visible').slideUp(200);
                this.$element.find('.target-selector .target-dropdown-toggle .expand-arrow.expanded').removeClass('expanded');
            }
        });

        // Budget input handlers
        this.$element.on('change', '.budget-materials-input', (e) => {
            this.budgetMaterials = parseInt(e.target.value) || 0;
        });
        this.$element.on('change', '.budget-target-input', (e) => {
            this.budgetTarget = parseInt(e.target.value) || 0;
        });

        // Skip obtained collectibles checkbox
        this.$element.on('change', '.skip-obtained-collectibles', (e) => {
            if (window.settingsModal) {
                window.settingsModal.skipObtainedCollectibles = e.target.checked;
                localStorage.setItem('skipObtainedCollectibles', e.target.checked.toString());
                window.settingsModal.saveOptimizationSettings();
            }
            // Toggle green/italic styling on the label
            const $label = $(e.target).closest('label').find('.optimizer-checkbox-label');
            if (e.target.checked) {
                $label.css({ color: '#27ae60', fontStyle: 'italic' });
            } else {
                $label.css({ color: 'var(--text-muted)', fontStyle: 'normal' });
            }
        });

        // Target drop rate input (for fine_item/collectible)
        this.$element.on('input', '.target-rate-input', (e) => {
            this.targetDropRate = parseFloat(e.target.value) || 0;
            // Persist to session
            store.update('ui.column3.targetDropRate', this.targetDropRate);
            // Update display name in the dropdown button
            this.$element.find('.target-dropdown-value span').text(this.getTargetDisplayName());
        });

        // Wire info popover icons
        wireInfoIcons(this.$element[0]);

        // Set rich HTML on instant-actions info icons (must be after DOM is ready)
        if (this._instantActionsPopoverHtml) {
            this.$element.find('.instant-actions-info-icon').each((_, el) => {
                el.dataset.infoHtml = this._instantActionsPopoverHtml;
            });
            wireInfoIcons(this.$element[0]);
        }
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        $(document).off('click.target-dropdown');
        super.destroy();
    }
}

export default OptimizeButton;
