/**
 * State Store - Observable State Management with jQuery
 * 
 * Manages application state and notifies subscribers of changes.
 * Automatically syncs state changes to backend via jQuery AJAX.
 */

import { computeSwap, computeAlternativesSwap } from './utils/slot-reorder.js';

class StateStore {
    constructor() {
        this.state = {
            session: {
                uuid: null,
                loaded: false
            },
            character: {
                skills: {},
                reputation: {},
                achievement_points: 0,
                total_skill_level: 0,
                coins: 0
            },
            items: {}, // item_id -> { has: bool, hide: bool, quality: string }
            gearsets: {
                // Current equipped gear (auto-saved, not in dropdown)
                current: {
                    head: null,
                    cape: null,
                    back: null,
                    hands: null,
                    chest: null,
                    neck: null,
                    primary: null,
                    legs: null,
                    secondary: null,
                    ring1: null,
                    ring2: null,
                    feet: null,
                    tool0: null,
                    tool1: null,
                    tool2: null,
                    tool3: null,
                    tool4: null,
                    tool5: null,
                    consumable: null,
                    pet: null
                },
                saved: {},  // id -> { name, slots }
                selectedId: null,  // Currently selected saved gearset ID (null = new/unsaved)
                selectedName: '',   // Name in text box
                lockedSlots: {},  // Per-slot lock state { "head": true, "tool2": true }
                // Comparison mode: two gearsets side by side
                comparisonMode: false,
                activeGearsetSlot: 1,  // Which gearset is being edited (1 or 2)
                gearset2: {  // Second gearset for comparison
                    head: null, cape: null, back: null, hands: null,
                    chest: null, neck: null, primary: null, legs: null,
                    secondary: null, ring1: null, ring2: null, feet: null,
                    tool0: null, tool1: null, tool2: null,
                    tool3: null, tool4: null, tool5: null,
                    consumable: null, pet: null
                },
                gearset2SavedId: null,  // ID of saved gearset loaded into slot 2
                gearset2SavedName: '',
                // Per-gearset Column 3 context (service, location, fine)
                gs1Context: { selectedService: null, selectedLocation: null, useFine: false },
                gs2Context: { selectedService: null, selectedLocation: null, useFine: false }
            },
            column3: {
                selectedActivity: null,
                selectedRecipe: null,
                selectedService: null,
                selectedLocation: null,
                useFine: false,
                showCombinedDrops: false,
                hideOwnedCollectibles: false,
                travelStart: null,
                travelEnd: null,
                showGenericServices: false,
                showGenericCommunity: false,
                showGenericRecipeCommunity: false,
                showGenericServiceCommunity: false,
                showGenericItemCommunity: false,
                genericActivity: null,
                genericRecipe: null,
                genericService: null,
                savedGenericActivities: [],
                savedGenericRecipes: [],
                savedGenericServices: [],
                calculator: {
                    steps: 0,
                    actions: 0,
                    materials: 0,
                    crafts: 0,
                    skillXP: {}
                }
            },
            ui: {
                collapsed: {},
                skipped_import: false,
                has_seen_custom_stats: false,
                has_seen_help: false,
                custom_stats: {},
                user_overrides: {
                    skills: {},
                    skills_xp: {},
                    reputation: {},
                    achievement_points: undefined,
                    coins: undefined,
                    items: {}
                },
                column2: {
                    showOwnedOnly: true,
                    showApplicableOnly: true,
                    showHiddenItems: false,
                    statFilter: 'None',  // Not persisted across reloads
                    expandedStats: []
                },
                crafting_tree: {
                    target_item_id: null,
                    nodes: [],
                    global_settings: {
                        target_quantity: 1,
                        daily_steps: 30000,
                        target_quality: 'Normal',
                        buffer_percentage: 0.05,
                        spoiler_protection: true
                    },
                    summary: null,
                    optimization_status: null
                }
            }
        };
        this.subscribers = new Map(); // path -> [callbacks]
    }

    /**
     * Subscribe to state changes at a specific path
     * @param {string} path - Dot-separated path (e.g., "items.TRAVELERS_KIT.has")
     * @param {Function} callback - Function to call when state changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
        if (!this.subscribers.has(path)) {
            this.subscribers.set(path, []);
        }
        this.subscribers.get(path).push(callback);

        // Return unsubscribe function
        return () => this.unsubscribe(path, callback);
    }

    /**
     * Unsubscribe a callback from a path
     * @param {string} path - Path to unsubscribe from
     * @param {Function} callback - Callback to remove
     */
    unsubscribe(path, callback) {
        if (this.subscribers.has(path)) {
            const callbacks = this.subscribers.get(path);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Update state and notify subscribers
     * @param {string} path - Dot-separated path to update
     * @param {*} value - New value to set
     */
    update(path, value) {
        this._setPath(path, value);
        this._notifySubscribers(path);
        this._syncToBackend(path, value);
    }

    /**
     * Get value at a specific path
     * @param {string} path - Dot-separated path
     * @returns {*} Value at path
     */
    get(path) {
        return this._getPath(path);
    }

    /**
     * Set nested path value (e.g., "items.TRAVELERS_KIT.has")
     * @private
     * @param {string} path - Dot-separated path
     * @param {*} value - Value to set
     */
    _setPath(path, value) {
        const parts = path.split('.');
        let obj = this.state;

        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) {
                obj[parts[i]] = {};
            }
            obj = obj[parts[i]];
        }

        obj[parts[parts.length - 1]] = value;
    }

    /**
     * Get value at nested path
     * @private
     * @param {string} path - Dot-separated path
     * @returns {*} Value at path
     */
    _getPath(path) {
        const parts = path.split('.');
        let obj = this.state;

        for (let i = 0; i < parts.length; i++) {
            if (obj === undefined || obj === null) {
                return undefined;
            }
            obj = obj[parts[i]];
        }

        return obj;
    }

    /**
     * Notify all subscribers for a path
     * @private
     * @param {string} path - Path that changed
     */
    _notifySubscribers(path) {
        if (this.subscribers.has(path)) {
            this.subscribers.get(path).forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    console.error('Error in subscriber callback:', error);
                }
            });
        }

        // Also notify parent paths (e.g., "items" when "items.X.has" changes)
        const parts = path.split('.');
        for (let i = parts.length - 1; i > 0; i--) {
            const parentPath = parts.slice(0, i).join('.');
            if (this.subscribers.has(parentPath)) {
                this.subscribers.get(parentPath).forEach(callback => {
                    try {
                        callback();
                    } catch (error) {
                        console.error('Error in parent subscriber callback:', error);
                    }
                });
            }
        }
    }

    /**
     * Sync change to backend using jQuery AJAX
     * @private
     * @param {string} path - Path that changed
     * @param {*} value - New value
     */
    _syncToBackend(path, value) {
        // Don't sync if session not loaded yet
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return;
        }

        // Don't sync statFilter - it should reset on page reload (Requirement 7.5)
        if (path === 'ui.column2.statFilter') {
            return;
        }

        // Debounce: Clear existing timeout for this path
        if (!this._syncTimeouts) {
            this._syncTimeouts = {};
        }
        if (!this._syncPendingValues) {
            this._syncPendingValues = {};
        }

        if (this._syncTimeouts[path]) {
            clearTimeout(this._syncTimeouts[path]);
        }

        // Store the pending value for flush
        this._syncPendingValues[path] = value;

        // Set new timeout - sync after 500ms of no changes
        this._syncTimeouts[path] = setTimeout(() => {
            console.log('Syncing to backend:', { path, value, uuid: this.state.session.uuid });
            delete this._syncPendingValues[path];

            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path, value }),
                success: (response) => {
                    console.log('Sync successful:', path, value, response);
                },
                error: (xhr, status, error) => {
                    console.error('Failed to sync state to backend:', path, error);
                    console.error('Response:', xhr.responseText);
                }
            });
        }, 500);
    }

    /**
     * Load state from backend
     * @param {string} uuid - Session UUID
     * @returns {Promise} Promise that resolves when state is loaded
     */
    loadSession(uuid) {
        return $.get(`/api/session/${uuid}`)
            .done((data) => {
                // Small summary always; full payload only when verbose debug is enabled.
                // The full response is multi-MB once the user has a populated character
                // (owned_items, raw_export_names, item_qualities, crafting_tree, gearsets,
                // currentGear, etc.) and JSON.stringify'ing it on every page load via the
                // debug-console capture layer is the single biggest log-related cost.
                const _cc = data && data.character_config ? data.character_config : {};
                console.log('[INIT] loadSession response:', {
                    uuid: data && data.uuid,
                    has_character_config: !!data?.character_config,
                    has_ui_config: !!data?.ui_config,
                    owned_items: Array.isArray(_cc.owned_items) ? _cc.owned_items.length : 0,
                    collectibles: Array.isArray(_cc.collectibles) ? _cc.collectibles.length : 0,
                    pets: Array.isArray(_cc.pets) ? _cc.pets.length : 0,
                    item_quality_keys: _cc.item_qualities ? Object.keys(_cc.item_qualities).length : 0,
                });
                if (window.__walkscapeVerboseDebug) {
                    console.log('[VERBOSE] loadSession full response:', data);
                }

                // Update state with loaded data
                this.state.session.uuid = uuid;
                this.state.session.loaded = true;

                if (data.character_config) {
                    this.state.character = data.character_config;

                    // Store inventory value from server
                    this.state.character.inventory_value = data.inventory_value || 0;

                    // Build items state from character's owned_items
                    this.state.items = {};

                    console.log('character_config.owned_items:', data.character_config.owned_items);
                    console.log('character_config.gear:', data.character_config.gear);

                    // Build export-name-to-item-id alias map for renamed items
                    const exportAliases = data.export_aliases || {};

                    // Add owned items (inventory + bank)
                    if (data.character_config.owned_items) {
                        data.character_config.owned_items.forEach(itemId => {
                            // Strip quality suffix for crafted items
                            // e.g., "kelp_diving_mask_uncommon" -> "kelp_diving_mask"
                            const raritySuffixes = ['_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal'];
                            const rarityToQuality = {
                                'common': 'Normal',
                                'uncommon': 'Good',
                                'rare': 'Great',
                                'epic': 'Excellent',
                                'legendary': 'Perfect',
                                'ethereal': 'Eternal'
                            };
                            let baseId = itemId;
                            let quality = null;  // Don't set quality for non-crafted items
                            let isFine = false;

                            // Check for _fine suffix (materials/consumables)
                            if (itemId.endsWith('_fine')) {
                                baseId = itemId.slice(0, -5);
                                isFine = true;
                            }

                            if (!isFine) {
                                for (const qualitySuffix of raritySuffixes) {
                                    if (itemId.endsWith(qualitySuffix)) {
                                        baseId = itemId.slice(0, -qualitySuffix.length);
                                        const rarity = qualitySuffix.slice(1); // Remove leading underscore
                                        quality = rarityToQuality[rarity] || 'Normal';
                                        break;
                                    }
                                }
                            }

                            // Resolve renamed items (e.g., camouflage_cape -> leaf_cape)
                            if (exportAliases[baseId]) {
                                baseId = exportAliases[baseId];
                            }

                            if (isFine) {
                                // Fine variant — set has_fine on the base item
                                if (!this.state.items[baseId]) {
                                    this.state.items[baseId] = { has: false, hide: false };
                                }
                                this.state.items[baseId].has_fine = true;
                            } else if (quality) {
                                this.state.items[baseId] = {
                                    has: true,
                                    hide: false,
                                    quality: quality
                                };
                            } else {
                                if (!this.state.items[baseId]) {
                                    this.state.items[baseId] = { has: true, hide: false };
                                } else {
                                    this.state.items[baseId].has = true;
                                }
                            }
                        });
                    }

                    // Add collectibles
                    if (data.character_config.collectibles) {
                        console.log('character_config.collectibles:', data.character_config.collectibles);
                        data.character_config.collectibles.forEach(collectibleId => {
                            this.state.items[collectibleId] = {
                                has: true,
                                hide: false
                            };
                        });
                    }

                    // Add pets from character export (if present)
                    if (data.character_config.pets && Array.isArray(data.character_config.pets)) {
                        console.log('character_config.pets:', data.character_config.pets);
                        // Read persisted pet overrides from ui_config (available in same response)
                        // so we can preserve user-set variant/petName even before ui_config is applied
                        const persistedItemOverrides = data.ui_config?.user_overrides?.items || {};
                        console.log('[PET-IMPORT] data.ui_config keys:', Object.keys(data.ui_config || {}));
                        console.log('[PET-IMPORT] persistedItemOverrides:', JSON.stringify(persistedItemOverrides));
                        data.character_config.pets.forEach(pet => {
                            if (!pet || typeof pet !== 'object') return;
                            // Use species for the pet ID (maps to catalog), fall back to name
                            const species = pet.species || pet.name || '';
                            const petId = species.toLowerCase().replace(/ /g, '_').replace(/[()'-]/g, '');
                            if (!petId) return;
                            // Only store petName for non-eggs (eggs use the egg item name, not a custom name)
                            const isEgg = pet.stage === 'egg' || pet.level === 0;
                            // Preserve user-set variant and petName — read from persisted ui_config overrides
                            const persistedOverride = persistedItemOverrides[petId] || {};
                            const preservedVariant = persistedOverride.variant;
                            const preservedPetName = persistedOverride.petName;
                            const chosenVariant = preservedVariant !== undefined ? preservedVariant : (pet.variant || 'normal');
                            console.log(`[PET-IMPORT] petId=${petId} persistedOverride=${JSON.stringify(persistedOverride)} preservedVariant=${preservedVariant} pet.variant=${pet.variant} chosenVariant=${chosenVariant}`);
                            // A species can appear multiple times in the export (the active pet
                            // plus duplicate copies in available_pets). Always keep the
                            // HIGHEST-level copy — never let a later (lower-level) entry clobber
                            // a higher-level one already recorded for this species.
                            const existing = this.state.items[petId];
                            const newLevel = pet.level || 0;
                            if (existing && (existing.level || 0) >= newLevel) {
                                // Already have an equal-or-higher copy. Don't downgrade, but
                                // preserve the active flag if this duplicate is the active pet.
                                if (pet.active && !existing.active) {
                                    existing.active = true;
                                }
                                return;
                            }
                            this.state.items[petId] = {
                                has: true,
                                hide: false,
                                level: newLevel,
                                // Keep user-chosen variant if persisted; fall back to what the import says
                                variant: chosenVariant,
                                petName: isEgg
                                    ? (preservedPetName !== undefined ? preservedPetName : '')
                                    : (preservedPetName !== undefined ? preservedPetName : (pet.name || '')),
                                xp: pet.xp || 0,
                                stage: pet.stage || '',
                                // Keep active=true if a previously-seen (lower-level) copy was the
                                // active pet, so swapping to the highest level doesn't lose it.
                                active: pet.active || (existing && existing.active) || false,
                            };
                        });
                    }

                    // Process item qualities for rings (and other crafted items)
                    if (data.character_config.item_qualities) {
                        console.log('=== PROCESSING ITEM QUALITIES ===');
                        console.log('character_config.item_qualities:', data.character_config.item_qualities);

                        for (const [itemId, qualitiesObj] of Object.entries(data.character_config.item_qualities)) {
                            // qualitiesObj is {quality: quantity}, e.g., {"Great": 2, "Good": 1}
                            console.log(`\n[${itemId}] Processing qualities:`, qualitiesObj);

                            // Sort qualities by hierarchy (highest first)
                            const qualityHierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];

                            // Debug: Show indices for each quality
                            console.log(`  Quality indices in hierarchy:`);
                            for (const quality of Object.keys(qualitiesObj)) {
                                const index = qualityHierarchy.indexOf(quality);
                                console.log(`    ${quality}: index ${index} (${index === -1 ? 'NOT FOUND!' : 'found'})`);
                            }

                            const sortedQualities = Object.keys(qualitiesObj).sort((a, b) => {
                                const indexA = qualityHierarchy.indexOf(a);
                                const indexB = qualityHierarchy.indexOf(b);
                                console.log(`    Comparing ${a} (index ${indexA}) vs ${b} (index ${indexB}): ${indexA - indexB}`);
                                return indexA - indexB;
                            });

                            console.log(`  Sorted qualities (highest first):`, sortedQualities);

                            // For rings, set ring1_quality and ring2_quality
                            // For other items, just set quality to highest
                            if (sortedQualities.length > 0) {
                                const highestQuality = sortedQualities[0];
                                const highestQuantity = qualitiesObj[highestQuality];

                                console.log(`  ✓ HIGHEST QUALITY: ${highestQuality} (qty: ${highestQuantity})`);

                                // Initialize item state if not exists
                                if (!this.state.items[itemId]) {
                                    this.state.items[itemId] = { has: true, hide: false };
                                }

                                // Set ring1_quality to highest quality
                                this.state.items[itemId].ring1_quality = highestQuality;
                                this.state.items[itemId].quality = highestQuality;  // Also set quality for non-ring items
                                console.log(`  → Set quality = ${highestQuality}`);
                                console.log(`  → Set ring1_quality = ${highestQuality}`);

                                // If we have 2+ of the highest quality, set ring2 to same quality
                                if (highestQuantity >= 2) {
                                    this.state.items[itemId].ring2_quality = highestQuality;
                                    console.log(`  → Set ring2_quality = ${highestQuality} (have ${highestQuantity})`);
                                }
                                // Otherwise, if we have a second quality, use that for ring2
                                else if (sortedQualities.length > 1) {
                                    this.state.items[itemId].ring2_quality = sortedQualities[1];
                                    console.log(`  → Set ring2_quality = ${sortedQualities[1]} (second quality)`);
                                }
                                // Otherwise, ring2 is "None"
                                else {
                                    this.state.items[itemId].ring2_quality = 'None';
                                    console.log(`  → Set ring2_quality = None (only one quality)`);
                                }

                                console.log(`  ✓ Final state for ${itemId}:`, JSON.stringify(this.state.items[itemId], null, 2));
                            }
                        }
                        console.log('=== DONE PROCESSING ITEM QUALITIES ===\n');
                    }

                    // Process item quantities for non-crafted items (especially rings)
                    if (data.character_config.item_quantities) {
                        console.log('character_config.item_quantities:', data.character_config.item_quantities);

                        for (const [itemId, quantity] of Object.entries(data.character_config.item_quantities)) {
                            console.log(`Processing quantity for ${itemId}: ${quantity}`);

                            // Initialize item state if not exists
                            if (!this.state.items[itemId]) {
                                this.state.items[itemId] = { has: true, hide: false };
                            }

                            // Set ring_quantity (cap at 2 for display purposes)
                            this.state.items[itemId].ring_quantity = Math.min(quantity, 2);
                            console.log(`  Set ring_quantity to ${this.state.items[itemId].ring_quantity}`);
                        }
                    }

                    // Gear is stored as {slot: export_name} like {"head": "Mining Helmet"}
                    // These should already be in owned_items, but log for debugging
                    if (data.character_config.gear) {
                        console.log('Gear items (export names):', Object.values(data.character_config.gear));
                    }

                    console.log('Built items state:', this.state.items);
                    console.log('Total items marked as owned:', Object.keys(this.state.items).length);
                }

                if (data.ui_config) {
                    // Preserve default column2 state, then merge with loaded config
                    const defaultColumn2 = {
                        showOwnedOnly: true,
                        showApplicableOnly: true,
                        showHiddenItems: false,
                        statFilter: 'None',  // Always reset to None on reload
                        expandedStats: []
                    };

                    this.state.ui = {
                        ...this.state.ui,
                        ...data.ui_config,
                        // Preserve skipped_import if not explicitly set in ui_config
                        skipped_import: data.ui_config.skipped_import ?? this.state.ui.skipped_import ?? false,
                        // Preserve has_seen_custom_stats if not explicitly set in ui_config
                        has_seen_custom_stats: data.ui_config.has_seen_custom_stats ?? this.state.ui.has_seen_custom_stats ?? false,
                        // Preserve has_seen_help if not explicitly set in ui_config
                        has_seen_help: data.ui_config.has_seen_help ?? this.state.ui.has_seen_help ?? false,
                        column2: {
                            ...defaultColumn2,
                            // Restore persisted checkbox states from ui_config
                            showOwnedOnly: data.ui_config.column2?.showOwnedOnly ?? true,
                            showApplicableOnly: data.ui_config.column2?.showApplicableOnly ?? true,
                            showHiddenItems: data.ui_config.column2?.showHiddenItems ?? false,
                            // statFilter is NOT persisted - always reset to 'None'
                            statFilter: 'None',
                            expandedStats: []
                        }
                    };

                    // Restore column1 state
                    if (!this.state.column1) this.state.column1 = {};
                    this.state.column1.showGenericItemCommunity = data.ui_config.column1?.showGenericItemCommunity ?? false;

                    // Merge ui_config items (hide states, quality overrides) with character items
                    if (data.ui_config.items) {
                        Object.keys(data.ui_config.items).forEach(itemId => {
                            if (!this.state.items[itemId]) {
                                this.state.items[itemId] = {};
                            }
                            // Merge hide and quality from ui_config
                            if (data.ui_config.items[itemId].hide !== undefined) {
                                this.state.items[itemId].hide = data.ui_config.items[itemId].hide;
                            }
                            if (data.ui_config.items[itemId].quality !== undefined) {
                                this.state.items[itemId].quality = data.ui_config.items[itemId].quality;
                            }
                        });
                    }

                    // Restore current gear set from ui_config
                    if (data.ui_config.currentGear) {
                        this.state.gearsets.current = {
                            ...this.state.gearsets.current,
                            ...data.ui_config.currentGear
                        };
                        console.log('Restored current gear from ui_config:', this.state.gearsets.current);
                    }

                    // Restore per-slot locks from ui_config
                    this.state.gearsets.lockedSlots = data.ui_config.lockedSlots || {};
                    this.state.gearsets.gearset2LockedSlots = data.ui_config.gearset2LockedSlots || {};

                    // Restore alternatives from ui_config
                    if (data.ui_config.alternatives) {
                        this.state.gearsets.alternatives = data.ui_config.alternatives;
                        console.log('Restored alternatives from ui_config:', Object.keys(data.ui_config.alternatives).length, 'slots');
                    }
                    if (data.ui_config.locked_alternatives) {
                        this.state.gearsets.lockedAlternatives = data.ui_config.locked_alternatives;
                        console.log('Restored locked alternatives from ui_config:', Object.keys(data.ui_config.locked_alternatives).length, 'slots');
                    }

                    // Restore column3 selection (activity/recipe/service/location)
                    if (data.ui_config.column3Selection) {
                        const saved = data.ui_config.column3Selection;
                        this.state.column3.selectedActivity = saved.selectedActivity ?? null;
                        this.state.column3.selectedRecipe = saved.selectedRecipe ?? null;
                        this.state.column3.selectedService = saved.selectedService ?? null;
                        this.state.column3.selectedLocation = saved.selectedLocation ?? null;
                        this.state.column3.selectedInputItems = saved.selectedInputItems ?? {};
                        this.state.column3.genericRecipeServiceId = saved.genericRecipeServiceId ?? null;
                        this.state.column3.useFine = saved.useFine ?? false;
                        this.state.column3.useFineInputs = saved.useFineInputs ?? false;
                        this.state.column3.hideOwnedCollectibles = saved.hideOwnedCollectibles ?? false;
                        this.state.column3.showGenericServices = saved.showGenericServices ?? false;
                        this.state.column3.showGenericCommunity = saved.showGenericCommunity ?? false;
                        this.state.column3.showGenericRecipeCommunity = saved.showGenericRecipeCommunity ?? false;
                        this.state.column3.showGenericServiceCommunity = saved.showGenericServiceCommunity ?? false;
                        this.state.column3.showGenericItemCommunity = saved.showGenericItemCommunity ?? false;
                        this.state.column3.travelStart = saved.travelStart ?? null;
                        this.state.column3.travelEnd = saved.travelEnd ?? null;
                        console.log('Restored column3 selection from ui_config:', saved);
                    }

                    // Restore comparison mode
                    console.log('[Comparison] ui_config.comparisonMode:', data.ui_config.comparisonMode);
                    console.log('[Comparison] ui_config.gearset2SavedId:', data.ui_config.gearset2SavedId);
                    console.log('[Comparison] ui_config.gearset2:', data.ui_config.gearset2 ? 'present' : 'absent');
                    if (data.ui_config.comparisonMode) {
                        this.state.gearsets.comparisonMode = true;
                        this.state.gearsets.activeGearsetSlot = 1;
                        this._pendingGearset2Id = data.ui_config.gearset2SavedId || null;
                        this._pendingGearset2Slots = data.ui_config.gearset2 || null;
                        // Restore per-gearset contexts (service, location, fine)
                        const gsConfig = data.ui_config.gearsets || {};
                        if (gsConfig.gs1Context) {
                            this.state.gearsets.gs1Context = { ...this.state.gearsets.gs1Context, ...gsConfig.gs1Context };
                        }
                        if (gsConfig.gs2Context) {
                            this.state.gearsets.gs2Context = { ...this.state.gearsets.gs2Context, ...gsConfig.gs2Context };
                        }
                        console.log('[Comparison] Set comparisonMode=true, pendingGearset2Id:', this._pendingGearset2Id, 'pendingSlots:', this._pendingGearset2Slots ? 'present' : 'absent');
                    }
                } else {
                    // No ui_config from backend, ensure skipped_import is false for new users
                    console.log('No ui_config from backend, initializing with defaults');
                    this.state.ui.skipped_import = false;
                    this.state.ui.has_seen_custom_stats = false;
                    this.state.ui.has_seen_help = false;
                }

                // Load saved gear sets from backend
                this._loadGearSets(uuid);

                // Notify all subscribers that state has loaded
                this._notifySubscribers('session');
                this._notifySubscribers('character');
                this._notifySubscribers('items');
                this._notifySubscribers('ui');
                this._notifySubscribers('gearsets');
                this._notifySubscribers('column3.selectedActivity');
                this._notifySubscribers('column3.selectedRecipe');
                this._notifySubscribers('column3.selectedService');
                this._notifySubscribers('column3.selectedLocation');
                this._notifySubscribers('column3.useFine');
                this._notifySubscribers('column3.hideOwnedCollectibles');
                this._notifySubscribers('column3.travelStart');
                this._notifySubscribers('column3.travelEnd');
            })
            .fail((xhr, status, error) => {
                console.error('Failed to load session:', error);
                throw new Error('Failed to load session');
            });
    }

    /**
     * Load saved gear sets from backend
     * @private
     * @param {string} uuid - Session UUID
     */
    _loadGearSets(uuid) {
        window.__walkscapePerf?.mark('gearsets_start');
        // Initial page load uses summary mode + limit. Backend omits slots_json
        // and export_string AND caps the result at the 50 most-recent gearsets
        // (sorted by updated_at DESC). Each gearset's full payload is fetched
        // on first use via _ensureGearSetFull(id). For accounts with 200+ saved
        // gearsets this drops gearsets_load from ~1156ms to a few hundred ms.
        // Total count comes back in the X-Total-Count header so the dropdown
        // can render a "Load all" button when more exist.
        const INITIAL_GEARSET_LIMIT = 50;
        // Use jQuery so the response object exposes headers consistently with
        // the rest of the codebase. The .always() callback receives the jqXHR
        // last on .done() / first on .fail(), so we capture it from a settings
        // hook instead.
        let totalCount = null;
        $.ajax({
            url: `/api/session/${uuid}/gearsets?summary=true&limit=${INITIAL_GEARSET_LIMIT}`,
            method: 'GET',
            dataType: 'json',
        }).done((gearSets, _textStatus, jqXHR) => {
                window.__walkscapePerf?.measure('gearsets_load', 'gearsets_start');
                // X-Total-Count tells us how many gearsets the user actually has.
                // Falls back to the returned list length if the header was stripped
                // by a CDN or proxy.
                const totalHeader = jqXHR && jqXHR.getResponseHeader && jqXHR.getResponseHeader('X-Total-Count');
                totalCount = totalHeader ? parseInt(totalHeader, 10) : (Array.isArray(gearSets) ? gearSets.length : 0);
                // Tightened summary log: count + first 5 names + last 5 names
                // so the bug-report blob stays small even for users with 200+
                // gearsets (each entry was ~80 bytes — 200 entries = ~16 KB).
                if (Array.isArray(gearSets)) {
                    const n = gearSets.length;
                    const head = gearSets.slice(0, 5).map(g => g.name);
                    const tail = n > 10 ? gearSets.slice(-5).map(g => g.name) : [];
                    const summaryLog = { count: n, total: totalCount, first: head };
                    if (tail.length) summaryLog.last = tail;
                    console.log('[INIT] Loaded gear sets:', summaryLog);
                } else {
                    console.log('[INIT] Loaded gear sets: (unexpected shape)', typeof gearSets);
                }
                if (window.__walkscapeVerboseDebug) {
                    console.log('[VERBOSE] Loaded gear sets full payload:', gearSets);
                }

                // Convert array to object keyed by id. In summary mode slots_json
                // and export_string come back undefined — mark the entry so
                // _ensureGearSetFull(id) knows to lazy-fetch on first use.
                this.state.gearsets.saved = {};
                gearSets.forEach(gearSet => {
                    this.state.gearsets.saved[gearSet.id] = {
                        name: gearSet.name,
                        slots: gearSet.slots_json,                       // undefined in summary mode
                        export_string: gearSet.export_string,            // undefined in summary mode
                        is_optimized: gearSet.is_optimized,
                        _summary_only: gearSet.slots_json === undefined, // sentinel for lazy fetch
                    };
                });

                // Track totals on the gearsets state so the manager UI can
                // render "Showing 50 of 200" + a "Load all" button.
                this.state.gearsets.totalCount = totalCount;
                this.state.gearsets.loadedCount = gearSets.length;
                this.state.gearsets.allLoaded = gearSets.length >= totalCount;

                // Restore gearset2 if comparison mode was persisted — must happen BEFORE
                // notifying 'gearsets.saved' so the comparison view renders with correct gearset2
                console.log('[Comparison] _loadGearSets: comparisonMode=', this.state.gearsets.comparisonMode, 'pendingGearset2Id=', this._pendingGearset2Id);

                const pendingId = this._pendingGearset2Id;
                const pendingSlots = this._pendingGearset2Slots;
                this._pendingGearset2Id = null;
                this._pendingGearset2Slots = null;

                const notifyAfterGearset2 = () => {
                    this._notifySubscribers('gearsets.saved');
                    if (this.state.gearsets.comparisonMode) {
                        this._notifySubscribers('gearsets.comparisonMode');
                    }
                };

                if (this.state.gearsets.comparisonMode) {
                    if (pendingSlots) {
                        // Prefer persisted slots — these represent the actual GS2 state
                        // including any modifications made after loading from a saved gearset
                        console.log('[Comparison] Restoring gearset2 from persisted slots');
                        this._isRestoringGearset2 = true;
                        this.state.gearsets.gearset2 = { ...this.state.gearsets.gearset2, ...pendingSlots };
                        if (pendingId) {
                            this.state.gearsets.gearset2SavedId = pendingId;
                            this.state.gearsets.gearset2SavedName = this.state.gearsets.saved[pendingId]?.name || '';
                        }
                        notifyAfterGearset2();
                        // Keep flag set past the undo debounce window (300ms) before clearing
                        setTimeout(() => { this._isRestoringGearset2 = false; }, 500);
                    } else if (pendingId && this.state.gearsets.saved[pendingId]) {
                        console.log('[Comparison] Loading gearset2 from saved:', pendingId);
                        // loadGearSetToSlot2 may be async (export string decode) — await before notifying
                        this._isRestoringGearset2 = true;
                        Promise.resolve(this.loadGearSetToSlot2(pendingId)).then(() => {
                            notifyAfterGearset2();
                            // Keep flag set past the undo debounce window (300ms) before clearing
                            setTimeout(() => { this._isRestoringGearset2 = false; }, 500);
                        });
                    } else {
                        // No saved gearset2 — only copy current if gearset2 is empty AND not during optimization
                        const hasGearset2Items = Object.values(this.state.gearsets.gearset2 || {}).some(v => v !== null);
                        if (!hasGearset2Items && !this._skipGearset2Copy) {
                            this.state.gearsets.gearset2 = { ...this.state.gearsets.current };
                            this._clearStaleGearset2Locks(this.state.gearsets.current);
                        }
                        notifyAfterGearset2();
                    }
                } else {
                    notifyAfterGearset2();
                }
            })
            .fail((xhr, status, error) => {
                console.error('Failed to load gear sets:', error);
            });
    }

    /**
     * Update a gear slot and auto-save current gear
     * @param {string} slot - Slot name (e.g., "head", "tool0")
     * @param {Object|null} item - Item data or null to unequip
     */
    updateGearSlot(slot, item) {
        // In comparison mode with slot 2 active, write to gearset2
        if (this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2) {
            this.state.gearsets.gearset2[slot] = item;

            // Clear gearset2 alternatives when user manually changes gear (they become stale)
            if (this.state.gearsets.gearset2Alternatives) {
                this.state.gearsets.gearset2Alternatives = null;
            }
            if (this.state.gearsets.gearset2LockedAlternatives) {
                this.state.gearsets.gearset2LockedAlternatives = null;
            }

            // If slot is locked, re-snapshot to the new item (or clear if unequipped)
            if (this.state.gearsets.gearset2LockedSlots?.[slot]) {
                const locks2 = { ...this.state.gearsets.gearset2LockedSlots };
                if (item === null) {
                    delete locks2[slot];
                } else {
                    locks2[slot] = {
                        itemId: item.itemId || null,
                        quality: item.quality || null,
                        level: item.level !== undefined ? item.level : undefined
                    };
                }
                this.state.gearsets.gearset2LockedSlots = locks2;
                this._notifySubscribers('gearsets.lockedSlots');
                this._syncToBackend('ui.gearset2LockedSlots', locks2);
            }

            this._notifySubscribers('gearsets.gearset2');
            this._saveGearset2();
            return;
        }

        // Update local state
        this.state.gearsets.current[slot] = item;

        // Clear alternatives when user manually changes gear (they become stale)
        if (this.state.gearsets.alternatives) {
            this.state.gearsets.alternatives = null;
            this._syncToBackend('ui.alternatives', null);
        }
        if (this.state.gearsets.lockedAlternatives) {
            this.state.gearsets.lockedAlternatives = null;
            this._syncToBackend('ui.locked_alternatives', null);
        }

        // If slot is locked, re-snapshot to the new item (or clear if unequipped)
        if (this.state.gearsets.lockedSlots?.[slot]) {
            const lockedSlots = { ...this.state.gearsets.lockedSlots };
            if (item === null) {
                delete lockedSlots[slot];
            } else {
                lockedSlots[slot] = {
                    itemId: item.itemId || null,
                    quality: item.quality || null,
                    level: item.level !== undefined ? item.level : undefined
                };
            }
            this.state.gearsets.lockedSlots = lockedSlots;
            this._notifySubscribers('gearsets.lockedSlots');
            this._syncToBackend('ui.lockedSlots', this.state.gearsets.lockedSlots);
        }

        // Notify subscribers
        // Note: Only notify the specific slot path - parent path subscribers
        // (like 'gearsets.current') will be automatically notified by _notifySubscribers
        this._notifySubscribers(`gearsets.current.${slot}`);

        // Auto-save current gear to backend
        this._saveCurrentGear();
    }

    /**
     * Atomically swap the item contents of two slots (used by tool/ring
     * reordering in Column 2). Mirrors updateGearSlot's persistence and
     * per-slot-lock behaviour but exchanges both slots with a single notify +
     * save, so the gearset, Save and Export buttons reflect the new order
     * immediately and the swap is a single undo step.
     *
     * @param {string} slotA - First slot identifier.
     * @param {string} slotB - Second slot identifier.
     */
    swapGearSlots(slotA, slotB) {
        if (!slotA || !slotB || slotA === slotB) return;

        const inComparison = this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2;
        const gearset = inComparison ? this.state.gearsets.gearset2 : this.state.gearsets.current;
        if (!gearset) return;

        // Nothing to do if both slots are already empty.
        if (gearset[slotA] == null && gearset[slotB] == null) return;

        const swapped = computeSwap(gearset, slotA, slotB);
        gearset[slotA] = swapped[slotA];
        gearset[slotB] = swapped[slotB];

        if (inComparison) {
            // Carry each swapped slot's cached alternatives along with its item
            // so the non-owned/locked upgrade sections follow the swap instead of
            // being discarded (which used to force a full re-optimize). All other
            // slots' suggestion lists are preserved untouched.
            if (this.state.gearsets.gearset2Alternatives) {
                this.state.gearsets.gearset2Alternatives =
                    computeAlternativesSwap(this.state.gearsets.gearset2Alternatives, slotA, slotB);
            }
            if (this.state.gearsets.gearset2LockedAlternatives) {
                this.state.gearsets.gearset2LockedAlternatives =
                    computeAlternativesSwap(this.state.gearsets.gearset2LockedAlternatives, slotA, slotB);
            }

            this._reSnapshotSlotLock('gearset2LockedSlots', slotA, gearset[slotA], 'ui.gearset2LockedSlots');
            this._reSnapshotSlotLock('gearset2LockedSlots', slotB, gearset[slotB], 'ui.gearset2LockedSlots');

            this._notifySubscribers('gearsets.gearset2');
            this._saveGearset2();
            return;
        }

        // Carry each swapped slot's cached alternatives along with its item so
        // the non-owned/locked upgrade sections follow the swap instead of being
        // discarded (which used to force a full re-optimize). All other slots'
        // suggestion lists are preserved untouched.
        if (this.state.gearsets.alternatives) {
            const swappedAlts = computeAlternativesSwap(this.state.gearsets.alternatives, slotA, slotB);
            this.state.gearsets.alternatives = swappedAlts;
            this._syncToBackend('ui.alternatives', swappedAlts);
        }
        if (this.state.gearsets.lockedAlternatives) {
            const swappedLocked = computeAlternativesSwap(this.state.gearsets.lockedAlternatives, slotA, slotB);
            this.state.gearsets.lockedAlternatives = swappedLocked;
            this._syncToBackend('ui.locked_alternatives', swappedLocked);
        }

        this._reSnapshotSlotLock('lockedSlots', slotA, gearset[slotA], 'ui.lockedSlots');
        this._reSnapshotSlotLock('lockedSlots', slotB, gearset[slotB], 'ui.lockedSlots');

        this._notifySubscribers(`gearsets.current.${slotA}`);
        this._notifySubscribers(`gearsets.current.${slotB}`);
        // Refresh any open slot popup so it shows the swapped slot's alternatives.
        this._notifySubscribers('gearsets.alternatives');
        this._notifySubscribers('gearsets.lockedAlternatives');
        this._saveCurrentGear();
    }

    /**
     * Re-snapshot (or clear) a per-slot lock after that slot's item changed.
     * Shared by swapGearSlots for each swapped slot; mirrors the inline locking
     * logic in updateGearSlot. A locked slot pins whatever item now occupies it.
     * @private
     */
    _reSnapshotSlotLock(locksKey, slot, item, syncPath) {
        const locks = this.state.gearsets[locksKey];
        if (!locks || !locks[slot]) return;
        const updated = { ...locks };
        if (item == null) {
            delete updated[slot];
        } else {
            updated[slot] = {
                itemId: item.itemId || null,
                quality: item.quality || null,
                level: item.level !== undefined ? item.level : undefined,
            };
        }
        this.state.gearsets[locksKey] = updated;
        this._notifySubscribers('gearsets.lockedSlots');
        this._syncToBackend(syncPath, updated);
    }

    /**
     * Get the currently active gearset (respects comparison mode)
     * @returns {Object} The active gearset slots
     */
    getActiveGearset() {
        if (this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2) {
            return this.state.gearsets.gearset2;
        }
        return this.state.gearsets.current;
    }

    /**
     * Build the full column3Data payload for persistence.
     * This is the single source of truth for what gets saved under
     * ui.column3Selection — both the debounced auto-save path
     * (_saveColumn3Selection) and the synchronous flush path
     * (flushPendingSaves) MUST use this builder so that pre-optimization
     * flushes don't strip fields like travelStart/travelEnd, which the
     * backend would otherwise overwrite as missing on the next PATCH.
     * @private
     * @returns {Object} Full column3 selection payload
     */
    _buildColumn3Data() {
        return {
            selectedActivity: this.state.column3.selectedActivity,
            selectedRecipe: this.state.column3.selectedRecipe,
            selectedService: this.state.column3.selectedService,
            selectedLocation: this.state.column3.selectedLocation,
            selectedInputItems: this.state.column3.selectedInputItems || {},
            genericRecipeServiceId: this.state.column3.genericRecipeServiceId || null,
            useFine: this.state.column3.useFine,
            useFineInputs: this.state.column3.useFineInputs,
            hideOwnedCollectibles: this.state.column3.hideOwnedCollectibles,
            showGenericServices: this.state.column3.showGenericServices,
            showGenericCommunity: this.state.column3.showGenericCommunity,
            showGenericRecipeCommunity: this.state.column3.showGenericRecipeCommunity,
            showGenericServiceCommunity: this.state.column3.showGenericServiceCommunity,
            showGenericItemCommunity: this.state.column3.showGenericItemCommunity,
            travelStart: this.state.column3.travelStart,
            travelEnd: this.state.column3.travelEnd
        };
    }

    /**
     * Save column3 selection (activity/recipe/service/location) to backend (auto-save)
     * @private
     */
    _saveColumn3Selection() {
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return;
        }

        // Debounce column3 saves
        if (this._column3SaveTimeout) {
            clearTimeout(this._column3SaveTimeout);
        }

        this._column3SaveTimeout = setTimeout(() => {
            const column3Data = this._buildColumn3Data();

            console.log('Auto-saving column3 selection:', column3Data);

            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({
                    path: 'ui.column3Selection',
                    value: column3Data
                }),
                success: (response) => {
                    console.log('Column3 selection auto-saved successfully');
                },
                error: (xhr, status, error) => {
                    console.error('Failed to auto-save column3 selection:', error);
                }
            });
        }, 500);
    }

    /**
     * Save current gear set to backend (auto-save)
     * @private
     */
    _saveCurrentGear() {
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return;
        }

        // Debounce current gear saves
        if (this._currentGearSaveTimeout) {
            clearTimeout(this._currentGearSaveTimeout);
        }

        this._currentGearSaveTimeout = setTimeout(() => {
            // Normalize any UUID-format itemId values to short-name format before saving.
            // Some older sessions stored itemId as the full UUID (e.g. "item-warm_beanie-26728220-...")
            // instead of the short catalog id (e.g. "warm_beanie"). Normalize using the cached catalog
            // so the saved data is always in the correct format.
            const catalogItems = api._catalogCache?.items || [];
            const gearToSave = {};
            for (const [slot, slotItem] of Object.entries(this.state.gearsets.current)) {
                if (!slotItem) { gearToSave[slot] = slotItem; continue; }
                if (slotItem.itemId && catalogItems.length > 0) {
                    // Check if itemId is a UUID-format that doesn't match any catalog id
                    const byId = catalogItems.find(item => item.id === slotItem.itemId);
                    if (!byId) {
                        const byUuid = catalogItems.find(item => item.uuid === slotItem.itemId);
                        if (byUuid) {
                            // Normalize: replace UUID with short id
                            gearToSave[slot] = { ...slotItem, itemId: byUuid.id };
                            continue;
                        }
                    }
                }
                gearToSave[slot] = slotItem;
            }

            console.log('Auto-saving current gear:', gearToSave);

            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({
                    path: 'ui.currentGear',
                    value: gearToSave
                }),
                success: (response) => {
                    console.log('Current gear auto-saved successfully');
                },
                error: (xhr, status, error) => {
                    console.error('Failed to auto-save current gear:', error);
                }
            });
        }, 500);
    }

    /**
     * Auto-save gearset2 to backend (comparison mode)
     * @private
     */
    _saveGearset2() {
        if (!this.state.session.loaded || !this.state.session.uuid) return;
        if (!this.state.gearsets.comparisonMode) return;

        const slotCount = Object.values(this.state.gearsets.gearset2 || {}).filter(v => v !== null).length;
        console.log(`[Comparison] _saveGearset2: saving ${slotCount} slots to backend`);

        if (this._gearset2SaveTimeout) {
            clearTimeout(this._gearset2SaveTimeout);
        }

        this._gearset2SaveTimeout = setTimeout(() => {
            console.log('[Comparison] _saveGearset2: PATCH firing now');
            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({
                    path: 'ui.gearset2',
                    value: this.state.gearsets.gearset2
                }),
                success: () => console.log('[Comparison] _saveGearset2: PATCH success'),
                error: (xhr) => console.error('[Comparison] _saveGearset2: PATCH failed', xhr.responseText),
            });
        }, 500);
    }

    /**
     * Flush all pending debounced saves immediately.
     * Returns a promise that resolves when all saves complete.
     * Call before optimization to ensure backend has latest state.
     */
    async flushPendingSaves() {
        const promises = [];

        // Flush all debounced _syncToBackend calls
        if (this._syncTimeouts && this._syncPendingValues) {
            for (const [path, timeoutId] of Object.entries(this._syncTimeouts)) {
                clearTimeout(timeoutId);
                const value = this._syncPendingValues[path];
                if (value !== undefined) {
                    promises.push($.ajax({
                        url: `/api/session/${this.state.session.uuid}/config`,
                        method: 'PATCH',
                        contentType: 'application/json',
                        data: JSON.stringify({ path, value })
                    }));
                }
            }
            this._syncTimeouts = {};
            this._syncPendingValues = {};
        }

        if (this._currentGearSaveTimeout) {
            clearTimeout(this._currentGearSaveTimeout);
            this._currentGearSaveTimeout = null;
            promises.push($.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path: 'ui.currentGear', value: this.state.gearsets.current })
            }));
        }

        if (this._gearset2SaveTimeout) {
            clearTimeout(this._gearset2SaveTimeout);
            this._gearset2SaveTimeout = null;
            promises.push($.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path: 'ui.gearset2', value: this.state.gearsets.gearset2 })
            }));
        }

        if (this._column3SaveTimeout) {
            clearTimeout(this._column3SaveTimeout);
            this._column3SaveTimeout = null;
            const column3Data = this._buildColumn3Data();
            promises.push($.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path: 'ui.column3Selection', value: column3Data })
            }));
        }

        if (promises.length > 0) {
            console.log(`[Store] Flushing ${promises.length} pending saves before optimization`);
            await Promise.all(promises);
            console.log('[Store] All pending saves flushed');
        }
    }

    /**
     * Save a named gear set to backend
     * @param {string} name - Gear set name
     * @param {string|null} id - Existing gear set ID (for updates)
     * @returns {Promise} jQuery promise
     */
    saveGearSet(name, id = null) {
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return $.Deferred().reject('Session not loaded').promise();
        }

        // Flush any pending currentGear save to ensure ui_config is up to date
        if (this._currentGearSaveTimeout) {
            clearTimeout(this._currentGearSaveTimeout);
            this._currentGearSaveTimeout = null;
            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path: 'ui.currentGear', value: this.state.gearsets.current })
            });
        }

        // In comparison mode with slot 2 active, save gearset2
        const activeGear = (this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2)
            ? this.state.gearsets.gearset2
            : this.state.gearsets.current;

        const data = {
            name: name,
            slots: { ...activeGear }  // Note: lockedSlots intentionally excluded (transient state)
        };

        if (id) {
            data.id = id;
        }

        return $.ajax({
            url: `/api/session/${this.state.session.uuid}/gearsets`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).done((gearSet) => {
            console.log('Gear set saved:', gearSet);

            // Update local state
            this.state.gearsets.saved[gearSet.id] = {
                name: gearSet.name,
                slots: gearSet.slots_json
            };

            const isSlot2 = this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2;
            if (isSlot2) {
                this.state.gearsets.gearset2SavedId = gearSet.id;
                this.state.gearsets.gearset2SavedName = gearSet.name;
                this._notifySubscribers('gearsets.gearset2SavedId');
                this._notifySubscribers('gearsets.gearset2SavedName');
                // Persist gearset2SavedId to backend so it restores on reload
                this._syncToBackend('ui.gearset2SavedId', gearSet.id);
            } else {
                this.state.gearsets.selectedId = gearSet.id;
                this.state.gearsets.selectedName = gearSet.name;
                this._notifySubscribers('gearsets.selectedId');
                this._notifySubscribers('gearsets.selectedName');
            }

            this._notifySubscribers('gearsets.saved');
        });
    }

    /**
     * Lazy-fetch ALL of the user's gearsets (still in summary mode — the
     * heavy slots_json / export_string fields are still populated on demand
     * via _ensureGearSetFull). Used by the gear-set manager when the user
     * clicks "Load all" or starts searching, so they can find old gearsets
     * that were trimmed off by the initial 50-item limit.
     *
     * Idempotent — once allLoaded flag is set, returns immediately.
     */
    _loadAllGearSets() {
        if (this.state.gearsets.allLoaded) {
            return Promise.resolve(this.state.gearsets.saved);
        }
        if (this._loadingAllGearsets) {
            return this._loadingAllGearsets;
        }

        const uuid = this.state.session?.uuid;
        if (!uuid) return Promise.resolve(null);

        this._loadingAllGearsets = new Promise((resolve) => {
            window.__walkscapePerf?.mark('gearsets_loadall_start');
            $.ajax({
                url: `/api/session/${uuid}/gearsets?summary=true`,
                method: 'GET',
                dataType: 'json',
            })
                .done((gearSets, _status, jqXHR) => {
                    window.__walkscapePerf?.measure('gearsets_loadall', 'gearsets_loadall_start');
                    const totalHeader = jqXHR && jqXHR.getResponseHeader && jqXHR.getResponseHeader('X-Total-Count');
                    const totalCount = totalHeader ? parseInt(totalHeader, 10) : (Array.isArray(gearSets) ? gearSets.length : 0);
                    console.log('[GEARSETS] Loaded all:', { count: gearSets.length, total: totalCount });

                    // Merge: keep any entries that have already been hydrated
                    // by _ensureGearSetFull, otherwise replace.
                    const existing = this.state.gearsets.saved || {};
                    const merged = {};
                    gearSets.forEach(gs => {
                        const prev = existing[gs.id];
                        if (prev && !prev._summary_only) {
                            merged[gs.id] = prev;
                        } else {
                            merged[gs.id] = {
                                name: gs.name,
                                slots: gs.slots_json,
                                export_string: gs.export_string,
                                is_optimized: gs.is_optimized,
                                _summary_only: gs.slots_json === undefined,
                            };
                        }
                    });
                    this.state.gearsets.saved = merged;
                    this.state.gearsets.totalCount = totalCount;
                    this.state.gearsets.loadedCount = gearSets.length;
                    this.state.gearsets.allLoaded = true;
                    this._notifySubscribers('gearsets.saved');
                    this._loadingAllGearsets = null;
                    resolve(this.state.gearsets.saved);
                })
                .fail((xhr) => {
                    console.warn('[gearsets-loadall] Failed:', xhr.status, xhr.statusText);
                    this._loadingAllGearsets = null;
                    resolve(this.state.gearsets.saved);
                });
        });
        return this._loadingAllGearsets;
    }

    /**
     * Lazy-fetch a single gearset's full payload (slots_json, export_string)
     * if it was loaded in summary mode. Idempotent — once populated, the
     * `_summary_only` flag is cleared and subsequent calls are no-ops.
     *
     * Returns a Promise that resolves to the populated saved-gearset entry,
     * or null if the gearset id is unknown / fetch fails.
     */
    _ensureGearSetFull(id) {
        const gearSet = this.state.gearsets.saved[id];
        if (!gearSet) return Promise.resolve(null);
        if (!gearSet._summary_only) return Promise.resolve(gearSet);

        // Already in flight? Reuse the same promise.
        if (gearSet._loading_full) return gearSet._loading_full;

        const uuid = this.state.session?.uuid;
        if (!uuid) return Promise.resolve(gearSet);

        const promise = new Promise((resolve) => {
            window.__walkscapePerf?.mark(`gs_full_${id}_start`);
            $.get(`/api/session/${uuid}/gearsets/${id}`)
                .done((full) => {
                    window.__walkscapePerf?.measure(`gs_full_${id}`, `gs_full_${id}_start`);
                    gearSet.slots = full.slots_json;
                    gearSet.export_string = full.export_string;
                    gearSet._summary_only = false;
                    gearSet._loading_full = null;
                    resolve(gearSet);
                })
                .fail((xhr) => {
                    console.warn(`[gearset-lazy] Failed to fetch full gearset ${id}:`, xhr.status, xhr.statusText);
                    gearSet._loading_full = null;
                    // Clear the summary flag anyway so we don't retry forever.
                    gearSet._summary_only = false;
                    resolve(gearSet);
                });
        });
        gearSet._loading_full = promise;
        return promise;
    }

    /**
     * Load a saved gear set into current gear
     * @param {string} id - Gear set ID
     */
    loadGearSet(id) {
        const gearSet = this.state.gearsets.saved[id];
        if (!gearSet) {
            console.error('Gear set not found:', id);
            return Promise.resolve();
        }

        // Lazy-fetch full payload if this entry was loaded in summary mode.
        if (gearSet._summary_only) {
            return this._ensureGearSetFull(id).then(() => this.loadGearSet(id));
        }

        // If this gearset has an export_string, decode it for full item enrichment.
        // This applies to both optimized and non-optimized gearsets — the export string
        // contains full item data that the catalog can enrich properly.
        if (gearSet.export_string) {
            console.log('Loading gearset from export string...');
            // Pass slots whenever they exist — alternatives (_alternatives, _locked_alternatives)
            // and consumable data all live in slots_json and need to be forwarded to loadGearSetFromExport.
            const extraSlots = gearSet.slots || null;
            return this.loadGearSetFromExport(gearSet.export_string, id, gearSet.name, extraSlots);
        } else {
            // Preserve per-slot locks for slots where the item doesn't change
            const newSlots = gearSet.slots;
            const lockedSlots = { ...(this.state.gearsets.lockedSlots || {}) };
            let locksChanged = false;
            for (const slot of Object.keys(lockedSlots)) {
                const lockValue = lockedSlots[slot];
                // New format: lock has snapshotted itemId; legacy: boolean true
                const lockedItemId = (lockValue && typeof lockValue === 'object') ? lockValue.itemId : null;
                const newItemId = newSlots[slot]?.itemId;
                // Remove lock if the new gearset has a different item in this slot
                if (lockedItemId && lockedItemId !== newItemId) {
                    delete lockedSlots[slot];
                    locksChanged = true;
                } else if (!lockedItemId) {
                    // Legacy boolean lock: compare old current vs new
                    const oldItemId = this.state.gearsets.current[slot]?.itemId;
                    if (oldItemId !== newItemId) {
                        delete lockedSlots[slot];
                        locksChanged = true;
                    }
                }
            }
            if (locksChanged) {
                this.state.gearsets.lockedSlots = lockedSlots;
                this._notifySubscribers('gearsets.lockedSlots');
                this._syncToBackend('ui.lockedSlots', this.state.gearsets.lockedSlots);
            }

            // Regular gearset - use slots directly (strip metadata keys)
            // Enrich any raw {itemId, quality} slots from the catalog cache.
            const catalogItems = api._catalogCache?.items || [];
            const cleanSlots = {};
            for (const [k, v] of Object.entries(newSlots)) {
                if (k.startsWith('_')) continue;
                if (v && v.itemId && catalogItems.length > 0 && !v.name) {
                    // Raw slot — enrich from catalog
                    let catalogItem = catalogItems.find(item => item.id === v.itemId);
                    if (!catalogItem) catalogItem = catalogItems.find(item => item.uuid === v.itemId);
                    if (catalogItem) {
                        const quality = v.quality || null;
                        let enriched = { ...catalogItem, itemId: catalogItem.id };
                        if (quality && catalogItem.type === 'crafted_item') {
                            const qualityMap = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                            enriched.quality = qualityMap[quality] || quality;
                            enriched.rarity = quality;
                        }
                        cleanSlots[k] = enriched;
                        continue;
                    }
                }
                cleanSlots[k] = v;
            }
            this.state.gearsets.current = cleanSlots;
            this.state.gearsets.selectedId = id;
            this.state.gearsets.selectedName = gearSet.name;

            // Extract alternatives if present
            if (newSlots._alternatives) {
                this.state.gearsets.alternatives = newSlots._alternatives;
                this._syncToBackend('ui.alternatives', newSlots._alternatives);
            } else {
                this.state.gearsets.alternatives = null;
                this._syncToBackend('ui.alternatives', null);
            }

            // Extract locked alternatives if present
            if (newSlots._locked_alternatives) {
                this.state.gearsets.lockedAlternatives = newSlots._locked_alternatives;
                this._syncToBackend('ui.locked_alternatives', newSlots._locked_alternatives);
            } else {
                this.state.gearsets.lockedAlternatives = null;
                this._syncToBackend('ui.locked_alternatives', null);
            }

            // Notify subscribers
            this._notifySubscribers('gearsets.current');
            this._notifySubscribers('gearsets.selectedId');
            this._notifySubscribers('gearsets.selectedName');

            // Auto-save the loaded gear as current
            this._saveCurrentGear();
            return Promise.resolve();
        }
    }

    /**
     * Load gearset from export string (for optimized gearsets)
     * @param {string} exportString - Base64 gzip compressed JSON
     * @param {string} id - Gearset ID
     * @param {string} name - Gearset name
     * @param {Object} extraSlots - Optional extra slot data (e.g., consumable from slots_json)
     */
    async loadGearSetFromExport(exportString, id, name, extraSlots = null) {
        try {
            // Decode export string
            const binaryString = atob(exportString);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const decompressed = pako.ungzip(bytes, { to: 'string' });
            const decoded = JSON.parse(decompressed);

            // Fetch catalog to enrich items
            const catalogResponse = await api.getCatalog();
            const catalog = catalogResponse.items;

            console.log('Catalog loaded, enriching items...');

            // One-time normalization: fix raw/UUID-format currentGear items from older sessions.
            // Items restored from ui_config may only have {itemId, quality} without name/rarity/etc.
            // Enrich them from the catalog so the gear slot grid and stats section display correctly.
            if (!this._currentGearNormalized) {
                this._currentGearNormalized = true;
                let normalized = false;
                for (const [slot, slotItem] of Object.entries(this.state.gearsets.current)) {
                    if (!slotItem || !slotItem.itemId) continue;
                    // If already enriched (has name and rarity), skip
                    if (slotItem.name && slotItem.rarity) continue;
                    // Find by short id first, then by UUID
                    let catalogItem = catalog.find(item => item.id === slotItem.itemId);
                    if (!catalogItem) {
                        catalogItem = catalog.find(item => item.uuid === slotItem.itemId);
                    }
                    if (catalogItem) {
                        const quality = slotItem.quality || null;
                        let enriched = { ...catalogItem, itemId: catalogItem.id };
                        if (quality && catalogItem.type === 'crafted_item') {
                            const qualityMap = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                            enriched.quality = qualityMap[quality] || quality;
                            enriched.rarity = quality;
                        }
                        this.state.gearsets.current[slot] = enriched;
                        normalized = true;
                    }
                }
                if (normalized) {
                    console.log('Normalized and enriched currentGear items from catalog');
                    this._notifySubscribers('gearsets.current');
                    this._saveCurrentGear();
                }
            }

            // Convert to slots format with full item objects
            const slots = {};
            for (const item of decoded.items) {
                const slotName = item.type;
                const itemJson = item.item;

                // Skip empty slots
                if (!itemJson) {
                    continue;
                }

                const itemData = JSON.parse(itemJson);

                // Skip if itemData is null or doesn't have ID
                if (!itemData || !itemData.id) {
                    continue;
                }

                // Map slot names
                let finalSlotName = slotName;
                if (slotName === 'tool') {
                    finalSlotName = `tool${item.index}`;
                } else if (slotName === 'ring') {
                    finalSlotName = `ring${item.index + 1}`;
                }

                // Find full item object from catalog by UUID
                const itemQuality = itemData.quality;  // e.g., "uncommon"
                const fullItem = catalog.find(catalogItem => catalogItem.uuid === itemData.id);

                if (fullItem) {
                    // For crafted items with quality, set the quality property
                    if (fullItem.type === 'crafted_item' && itemQuality) {
                        const qualityMap = {
                            'common': 'Normal',
                            'uncommon': 'Good',
                            'rare': 'Great',
                            'epic': 'Excellent',
                            'legendary': 'Perfect',
                            'ethereal': 'Eternal'
                        };
                        const qualityName = qualityMap[itemQuality];

                        const enrichedItem = {
                            ...fullItem,
                            itemId: fullItem.id,
                            quality: qualityName,
                            rarity: itemQuality
                        };

                        slots[finalSlotName] = enrichedItem;
                        console.log(`  Enriched ${finalSlotName}: ${fullItem.name} (crafted, quality: ${qualityName})`);
                    } else {
                        const enrichedItem = {
                            ...fullItem,
                            itemId: fullItem.id
                        };

                        slots[finalSlotName] = enrichedItem;
                        console.log(`  Enriched ${finalSlotName}: ${fullItem.name} (rarity: ${fullItem.rarity})`);
                    }
                } else if (itemData.id && itemData.id.startsWith('generic::')) {
                    // Generic item — resolve entirely from store, no generic_slots needed
                    const genericId = itemData.id.replace('generic::item::', '');
                    const gi = (this.state.genericItems || []).find(g => g.id === genericId);
                    if (gi) {
                        const rarityToQuality = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                        const qualityName = rarityToQuality[itemQuality] || 'Normal';
                        slots[finalSlotName] = {
                            itemId: itemData.id,
                            name: gi.name,
                            icon_path: gi.icon_path,
                            icon: gi.icon || '⚡',
                            icon_color: gi.icon_color,
                            stats: gi.stats || {},
                            quality_stats: gi.quality_stats,
                            stats_by_quality: gi.quality_stats,
                            keywords: gi.keywords || [],
                            rarity: itemQuality || gi.rarity || 'common',
                            quality: qualityName,
                            slot: gi.slot,
                            type: gi.is_crafted ? 'crafted_item' : 'item',
                            is_crafted: gi.is_crafted,
                            is_generic: true,
                            gated_stats: gi.gated_stats || {},
                        };
                        console.log(`  Enriched ${finalSlotName}: ${gi.name} (generic, quality: ${qualityName})`);
                    } else {
                        console.warn('Generic item not found in store:', itemData.id);
                    }
                } else {
                    console.warn('Item not found in catalog:', itemData.id);
                }
            }

            console.log('Decoded and enriched gearset, total slots:', Object.keys(slots).length);

            // Backwards compat: restore pet meta and consumable from generic_slots
            // (Generic items are now resolved inline from the items array above)
            if (decoded.generic_slots) {
                // Pet level/variant metadata
                if (decoded.generic_slots._pet_meta && slots['pet']) {
                    const meta = decoded.generic_slots._pet_meta;
                    slots['pet'] = { ...slots['pet'], level: meta.level, variant: meta.variant, useAbility: meta.useAbility || false };
                }
                // Consumable slot (wiki consumables stored here for round-trip)
                if (decoded.generic_slots.consumable && !slots['consumable']) {
                    slots['consumable'] = decoded.generic_slots.consumable;
                }
            }

            // Merge extra slot data (e.g., consumable from optimization
            // and per-slot user overrides from tree-node locked_slots).
            //
            // Bug b788d037 follow-up: when the user changes any gear in
            // the gear preview and clicks Equip, those overrides are
            // stored in node.locked_slots. The Equip button passes them
            // via extraSlots, but the OLD merge only filled EMPTY slots
            // — so manual overrides on gear/tools/rings were silently
            // ignored (the export string had populated those slots
            // already with the optimizer's pick). Switch to OVERRIDE
            // semantics: extraSlots[slot], when set to a real item,
            // wins over the export-derived slot.
            //
            // Saved-gearset round-trip (loadGearSet path): unchanged
            // behavior — slots_json is built from the same source as
            // export_string, so slots[slot] === extraSlots[slot] for
            // gear/tools/rings, and the override is a no-op.
            //
            // Skip metadata keys (prefixed with _) — they're not gear slots.
            if (extraSlots) {
                console.log('[loadGearSetFromExport] extraSlots keys:', Object.keys(extraSlots));
                for (const [slotName, slotData] of Object.entries(extraSlots)) {
                    if (slotName.startsWith('_')) continue;
                    if (slotData === null) {
                        // Explicit unequip sentinel: force-empty the slot
                        // even if the export populated it. Tree-node
                        // popup's Unequip button uses this for slots
                        // the user explicitly cleared.
                        if (slots[slotName]) {
                            console.log(`  Unequipped slot ${slotName} via null sentinel`);
                            delete slots[slotName];
                        }
                        continue;
                    }
                    if (slotData) {
                        // Bug df8f9b6b (Banbo): travel optimizer's backend save
                        // (ui/app.py simple-travel block) used to write per-slot
                        // {itemId: <UUID>, quality: <rarity_string>} only — no
                        // name/icon/stats. Overriding the catalog-enriched slot
                        // from the export string with that minimal blob makes
                        // the gear preview render "undefined" tiles. The export-
                        // decoded slot is already correct, so when extraSlots
                        // lacks a name we skip the override and let the export
                        // value stand. (Activity/recipe auto-saves write fully
                        // enriched slots from state.gearsets.current, and tree-
                        // node Equip passes full item objects, so those paths
                        // always have name and behave unchanged.)
                        if (!slotData.name) {
                            console.log(`  Skipped malformed extra slot ${slotName} (no name): ${JSON.stringify(slotData)}`);
                            continue;
                        }
                        const previously = slots[slotName];
                        slots[slotName] = slotData;
                        if (!previously) {
                            console.log(`  Merged extra slot ${slotName}: ${slotData.name || JSON.stringify(slotData)}`);
                        } else {
                            console.log(`  Overrode extra slot ${slotName}: ${previously.name || previously.itemId || '?'} → ${slotData.name || slotData.itemId || '?'}`);
                        }
                    }
                }
            }
            console.log('[loadGearSetFromExport] final slots:', Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v ? (v.name || v.itemId || 'NO NAME/ID') : 'null'])));

            // Check for tools in locked slots and skip them
            const skippedTools = [];
            const _charLevel = (typeof window.calculateCharacterLevel === 'function')
                ? window.calculateCharacterLevel(this.state.character)
                : 1;
            const _getUnlockedToolSlots = (level) => {
                if (level < 20) return 3;
                if (level < 50) return 4;
                if (level < 80) return 5;
                return 6;
            };
            const _unlockedToolSlots = _getUnlockedToolSlots(_charLevel);

            for (const slotName of Object.keys(slots)) {
                if (slotName.startsWith('tool')) {
                    const slotIndex = parseInt(slotName.replace('tool', ''), 10);
                    if (slotIndex >= _unlockedToolSlots) {
                        const item = slots[slotName];
                        const toolNum = slotIndex + 1;
                        skippedTools.push(`${item.name || 'Unknown'} in Tool ${toolNum}`);
                        delete slots[slotName];
                    }
                }
            }

            if (skippedTools.length > 0) {
                const toolList = skippedTools.join(', ');
                console.warn(`Skipped ${skippedTools.length} tool(s) from imported gearset (slot not unlocked): ${toolList}`);
                if (typeof api !== 'undefined' && api.showWarning) {
                    api.showWarning(
                        `Skipped ${skippedTools.length} tool${skippedTools.length > 1 ? 's' : ''} from imported gearset (slot not unlocked): ${toolList}`,
                        { duration: 10000 }
                    );
                }
            }

            // Preserve per-slot locks for slots where the item doesn't change
            const lockedSlots = { ...(this.state.gearsets.lockedSlots || {}) };
            let locksChanged = false;
            for (const slot of Object.keys(lockedSlots)) {
                const lockValue = lockedSlots[slot];
                const lockedItemId = (lockValue && typeof lockValue === 'object') ? lockValue.itemId : null;
                const newItemId = slots[slot]?.itemId;
                if (lockedItemId && lockedItemId !== newItemId) {
                    delete lockedSlots[slot];
                    locksChanged = true;
                } else if (!lockedItemId) {
                    const oldItemId = this.state.gearsets.current[slot]?.itemId;
                    if (oldItemId !== newItemId) {
                        delete lockedSlots[slot];
                        locksChanged = true;
                    }
                }
            }
            if (locksChanged) {
                this.state.gearsets.lockedSlots = lockedSlots;
                this._notifySubscribers('gearsets.lockedSlots');
                this._syncToBackend('ui.lockedSlots', this.state.gearsets.lockedSlots);
            }

            // Update state
            this.state.gearsets.current = slots;
            this.state.gearsets.selectedId = id;
            this.state.gearsets.selectedName = name;

            // Extract alternatives from saved gearset slots_json
            console.log('extraSlots keys:', extraSlots ? Object.keys(extraSlots) : 'null');
            if (extraSlots && extraSlots._alternatives) {
                this.state.gearsets.alternatives = extraSlots._alternatives;
                this._syncToBackend('ui.alternatives', extraSlots._alternatives);
                console.log('Loaded slot alternatives:', Object.keys(extraSlots._alternatives).length, 'slots');
            } else {
                this.state.gearsets.alternatives = null;
                this._syncToBackend('ui.alternatives', null);
                console.log('No alternatives in extraSlots');
            }

            if (extraSlots && extraSlots._locked_alternatives) {
                this.state.gearsets.lockedAlternatives = extraSlots._locked_alternatives;
                this._syncToBackend('ui.locked_alternatives', extraSlots._locked_alternatives);
                console.log('Loaded locked alternatives:', Object.keys(extraSlots._locked_alternatives).length, 'slots');
            } else {
                this.state.gearsets.lockedAlternatives = null;
                this._syncToBackend('ui.locked_alternatives', null);
            }

            // Notify subscribers - only notify the overall current once
            // Don't notify individual slots as that would trigger parent notifications multiple times
            this._notifySubscribers('gearsets.current');
            this._notifySubscribers('gearsets.selectedId');
            this._notifySubscribers('gearsets.selectedName');

            // Auto-save
            this._saveCurrentGear();

        } catch (error) {
            console.error('Failed to decode gearset export:', error);
        }
    }

    /**
     * Load a saved gearset into comparison slot 2
     * @param {string} id - Saved gearset ID
     */
    loadGearSetToSlot2(id) {
        const gearSet = this.state.gearsets.saved[id];
        if (!gearSet) {
            console.error('Gear set not found for slot 2:', id);
            return Promise.resolve();
        }

        // Lazy-fetch full payload if this entry was loaded in summary mode.
        if (gearSet._summary_only) {
            return this._ensureGearSetFull(id).then(() => this.loadGearSetToSlot2(id));
        }

        if (gearSet.export_string && gearSet.is_optimized) {
            // Pass slots whenever they exist — alternatives and consumable data live in slots_json.
            const extraSlots = gearSet.slots || null;
            return this._loadGearSetToSlot2FromExport(gearSet.export_string, id, gearSet.name, extraSlots);
        } else {
            this.state.gearsets.gearset2 = { ...gearSet.slots };
            this.state.gearsets.gearset2SavedId = id;
            this.state.gearsets.gearset2SavedName = gearSet.name;
            this._clearStaleGearset2Locks(gearSet.slots);
            this._notifySubscribers('gearsets.gearset2');
            this._notifySubscribers('gearsets.gearset2SavedId');
            this._notifySubscribers('gearsets.gearset2SavedName');
            this._notifySubscribers('gearsets.lockedSlots');
            this._syncToBackend('ui.gearset2SavedId', id);
            return Promise.resolve();
        }
    }

    /** Remove gearset2 locks for slots that are empty in the given slots object */
    _clearStaleGearset2Locks(slots) {
        const locks2 = { ...(this.state.gearsets.gearset2LockedSlots || {}) };
        let changed = false;
        for (const lockedSlot of Object.keys(locks2)) {
            if (!slots[lockedSlot]) {
                delete locks2[lockedSlot];
                changed = true;
            }
        }
        if (changed) {
            this.state.gearsets.gearset2LockedSlots = locks2;
            this._syncToBackend('ui.gearset2LockedSlots', locks2);
        }
    }

    /**
     * Load an export string into comparison slot 2
     */
    async _loadGearSetToSlot2FromExport(exportString, id, name, extraSlots = null) {
        try {
            const binaryString = atob(exportString);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const decompressed = pako.ungzip(bytes, { to: 'string' });
            const decoded = JSON.parse(decompressed);

            const catalogResponse = await api.getCatalog();
            const catalog = catalogResponse.items;

            const slots = {};
            for (const item of decoded.items) {
                const slotName = item.type;
                const itemJson = item.item;
                if (!itemJson) continue;
                const itemData = JSON.parse(itemJson);
                if (!itemData || !itemData.id) continue;

                let finalSlotName = slotName;
                if (slotName === 'tool') finalSlotName = `tool${item.index}`;
                else if (slotName === 'ring') finalSlotName = `ring${item.index + 1}`;

                const itemQuality = itemData.quality;
                const fullItem = catalog.find(ci => ci.uuid === itemData.id);

                if (fullItem) {
                    if (fullItem.type === 'crafted_item' && itemQuality) {
                        const qualityMap = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                        slots[finalSlotName] = { ...fullItem, itemId: fullItem.id, quality: qualityMap[itemQuality], rarity: itemQuality };
                    } else {
                        slots[finalSlotName] = { ...fullItem, itemId: fullItem.id };
                    }
                } else if (itemData.id?.startsWith('generic::')) {
                    const genericId = itemData.id.replace('generic::item::', '');
                    const gi = (this.state.genericItems || []).find(g => g.id === genericId);
                    if (gi) {
                        const rarityToQuality = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                        slots[finalSlotName] = {
                            itemId: itemData.id, name: gi.name, icon_path: gi.icon_path,
                            icon: gi.icon || '⚡', icon_color: gi.icon_color,
                            stats: gi.stats || {}, quality_stats: gi.quality_stats,
                            stats_by_quality: gi.quality_stats, keywords: gi.keywords || [],
                            rarity: itemQuality || gi.rarity || 'common',
                            quality: rarityToQuality[itemQuality] || 'Normal',
                            slot: gi.slot, type: gi.is_crafted ? 'crafted_item' : 'item',
                            is_crafted: gi.is_crafted, is_generic: true, gated_stats: gi.gated_stats || {},
                        };
                    }
                }
            }

            if (decoded.generic_slots) {
                if (decoded.generic_slots._pet_meta && slots['pet']) {
                    const meta = decoded.generic_slots._pet_meta;
                    slots['pet'] = { ...slots['pet'], level: meta.level, variant: meta.variant, useAbility: meta.useAbility || false };
                }
                if (decoded.generic_slots.consumable && !slots['consumable']) {
                    slots['consumable'] = decoded.generic_slots.consumable;
                }
            }
            if (extraSlots) {
                for (const [slotName, slotData] of Object.entries(extraSlots)) {
                    if (slotName.startsWith('_')) continue;
                    if (slotData === null) {
                        // Explicit unequip sentinel — force-empty even
                        // if the export populated this slot. Same
                        // semantic as the gearset-1 path.
                        if (slots[slotName]) delete slots[slotName];
                        continue;
                    }
                    // Bug df8f9b6b (Banbo): see gearset-1 comment above.
                    // Skip malformed extraSlots blobs (missing name) so the
                    // catalog-enriched slot from the export string stands.
                    if (slotData && !slotData.name) continue;
                    if (slotData) slots[slotName] = slotData;
                }
            }

            // Check for tools in locked slots and skip them (gearset 2)
            {
                const charLevel = (typeof window.calculateCharacterLevel === 'function')
                    ? window.calculateCharacterLevel(this.state.character)
                    : 1;
                const getUnlocked = (level) => {
                    if (level < 20) return 3;
                    if (level < 50) return 4;
                    if (level < 80) return 5;
                    return 6;
                };
                const unlocked = getUnlocked(charLevel);
                const skipped = [];

                for (const slotName of Object.keys(slots)) {
                    if (slotName.startsWith('tool')) {
                        const idx = parseInt(slotName.replace('tool', ''), 10);
                        if (idx >= unlocked) {
                            const item = slots[slotName];
                            skipped.push(`${item.name || 'Unknown'} in Tool ${idx + 1}`);
                            delete slots[slotName];
                        }
                    }
                }

                if (skipped.length > 0) {
                    console.warn(`Skipped ${skipped.length} tool(s) from gearset 2 (slot not unlocked): ${skipped.join(', ')}`);
                }
            }

            // Extract alternatives for gearset 2 (same pattern as slot 1)
            if (extraSlots && extraSlots._alternatives) {
                this.state.gearsets.gearset2Alternatives = extraSlots._alternatives;
            } else {
                this.state.gearsets.gearset2Alternatives = null;
            }
            if (extraSlots && extraSlots._locked_alternatives) {
                this.state.gearsets.gearset2LockedAlternatives = extraSlots._locked_alternatives;
            } else {
                this.state.gearsets.gearset2LockedAlternatives = null;
            }

            this.state.gearsets.gearset2 = slots;
            this.state.gearsets.gearset2SavedId = id;
            this.state.gearsets.gearset2SavedName = name;

            // Clear locks for slots that are now empty in the new gearset
            const locks2 = { ...(this.state.gearsets.gearset2LockedSlots || {}) };
            let locksChanged = false;
            for (const lockedSlot of Object.keys(locks2)) {
                if (!slots[lockedSlot]) {
                    delete locks2[lockedSlot];
                    locksChanged = true;
                }
            }
            if (locksChanged) {
                this.state.gearsets.gearset2LockedSlots = locks2;
                this._syncToBackend('ui.gearset2LockedSlots', locks2);
            }

            this._notifySubscribers('gearsets.gearset2');
            this._notifySubscribers('gearsets.gearset2SavedId');
            this._notifySubscribers('gearsets.gearset2SavedName');
            this._notifySubscribers('gearsets.lockedSlots');
            this._syncToBackend('ui.gearset2SavedId', id);
        } catch (error) {
            console.error('Failed to decode gearset export for slot 2:', error);
        }
    }

    /**
     * Toggle comparison mode
     */
    toggleComparisonMode(enabled) {
        console.log('[Comparison] toggleComparisonMode called:', enabled);
        this.state.gearsets.comparisonMode = enabled;
        if (!enabled) {
            // Always return to slot 1 when leaving comparison mode so lock
            // operations target the correct (GS1) lock set.
            this.state.gearsets.activeGearsetSlot = 1;
        }
        this._notifySubscribers('gearsets.comparisonMode');
        this._syncToBackend('ui.comparisonMode', enabled);
        console.log('[Comparison] Synced comparisonMode to backend:', enabled);
    }

    /**
     * Delete a saved gear set
     * @param {string} id - Gear set ID
     * @returns {Promise} jQuery promise
     */
    deleteGearSet(id) {
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return $.Deferred().reject('Session not loaded').promise();
        }

        return $.ajax({
            url: `/api/session/${this.state.session.uuid}/gearsets/${id}`,
            method: 'DELETE'
        }).done(() => {
            console.log('Gear set deleted:', id);

            // Remove from local state
            delete this.state.gearsets.saved[id];

            // Clear selection if deleted gear set was selected
            if (this.state.gearsets.selectedId === id) {
                this.state.gearsets.selectedId = null;
                this.state.gearsets.selectedName = '';
                this._notifySubscribers('gearsets.selectedId');
                this._notifySubscribers('gearsets.selectedName');
            }

            this._notifySubscribers('gearsets.saved');
        });
    }

    /**
     * Create a new gear set (clear selection, keep current gear)
     */
    createNewGearSet() {
        this.state.gearsets.selectedId = null;
        this.state.gearsets.selectedName = '';

        this._notifySubscribers('gearsets.selectedId');
        this._notifySubscribers('gearsets.selectedName');
    }

    /**
     * Toggle per-slot lock on a gear slot.
     * If the slot has an item, toggles the lock immediately.
     * If the slot is empty, this is a no-op (pre-arm is handled by the popup).
     * @param {string} slotName - Slot to toggle (e.g., "head", "tool2")
     */
    toggleSlotLock(slotName) {
        // In comparison mode, use per-gearset locks
        if (this.state.gearsets.comparisonMode) {
            const activeSlot = this.state.gearsets.activeGearsetSlot || 1;
            const activeGearset = activeSlot === 1 ? this.state.gearsets.current : this.state.gearsets.gearset2;

            if (activeSlot === 2) {
                const locks2 = { ...(this.state.gearsets.gearset2LockedSlots || {}) };
                if (locks2[slotName]) {
                    // Always allow unlocking
                    delete locks2[slotName];
                } else if (activeGearset[slotName]) {
                    // Only lock if there's an item
                    const item = activeGearset[slotName];
                    locks2[slotName] = {
                        itemId: item.itemId || null,
                        quality: item.quality || null,
                        level: item.level !== undefined ? item.level : undefined
                    };
                } else {
                    return; // Nothing to lock
                }
                this.state.gearsets.gearset2LockedSlots = locks2;
                this._notifySubscribers('gearsets.lockedSlots');
                this._syncToBackend('ui.gearset2LockedSlots', locks2);
                return;
            }
        }

        // Gearset 1 or non-comparison mode
        const lockedSlots = { ...(this.state.gearsets.lockedSlots || {}) };

        if (lockedSlots[slotName]) {
            // Always allow unlocking
            delete lockedSlots[slotName];
        } else if (this.state.gearsets.current[slotName]) {
            // Only lock if there's an item
            const item = this.state.gearsets.current[slotName];
            lockedSlots[slotName] = {
                itemId: item.itemId || null,
                quality: item.quality || null,
                level: item.level !== undefined ? item.level : undefined
            };
        } else {
            return; // Nothing to lock
        }

        this.state.gearsets.lockedSlots = lockedSlots;
        this._notifySubscribers('gearsets.lockedSlots');
        this._syncToBackend('ui.lockedSlots', this.state.gearsets.lockedSlots);
    }

    /**
     * Get locked slots for the active gearset (comparison-aware)
     */
    getActiveLockedSlots() {
        if (this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2) {
            return this.state.gearsets.gearset2LockedSlots || {};
        }
        return this.state.gearsets.lockedSlots || {};
    }

    /**
     * Check if a slot is locked (works with both boolean and object lock formats)
     */
    isSlotLocked(slotName) {
        const locks = this.getActiveLockedSlots();
        return !!locks[slotName];
    }

    /**
     * Unequip all gear slots
     */
    unequipAll() {
        // In comparison mode with slot 2 active, unequip gearset2 (respecting locks)
        if (this.state.gearsets.comparisonMode && this.state.gearsets.activeGearsetSlot === 2) {
            const slots = Object.keys(this.state.gearsets.gearset2);
            const lockedSlots = this.state.gearsets.gearset2LockedSlots || {};
            slots.forEach(slot => {
                if (!lockedSlots[slot]) {
                    this.state.gearsets.gearset2[slot] = null;
                }
            });
            this._notifySubscribers('gearsets.gearset2');
            this._saveGearset2();
            return;
        }

        // Clear all slots, skipping per-slot locked ones
        const slots = Object.keys(this.state.gearsets.current);
        const lockedSlots = this.state.gearsets.lockedSlots || {};
        slots.forEach(slot => {
            if (!lockedSlots[slot]) {
                this.state.gearsets.current[slot] = null;
            }
        });

        // Notify subscribers
        this._notifySubscribers('gearsets.current');

        // Auto-save
        this._saveCurrentGear();
    }
}

// Global store instance
const store = new StateStore();

// Export for ES6 modules
export default store;

// Also make available globally for non-module scripts
window.store = store;
