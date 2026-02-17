/**
 * State Store - Observable State Management with jQuery
 * 
 * Manages application state and notifies subscribers of changes.
 * Automatically syncs state changes to backend via jQuery AJAX.
 */

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
                selectedName: ''   // Name in text box
            },
            column3: {
                selectedActivity: null,
                selectedRecipe: null,
                selectedService: null,
                selectedLocation: null,
                useFine: false,
                showCombinedDrops: false,
                hideOwnedCollectibles: false,
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
                    statFilter: 'None',  // Not persisted across reloads
                    expandedStats: []
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

        if (this._syncTimeouts[path]) {
            clearTimeout(this._syncTimeouts[path]);
        }

        // Set new timeout - sync after 500ms of no changes
        this._syncTimeouts[path] = setTimeout(() => {
            console.log('Syncing to backend:', { path, value, uuid: this.state.session.uuid });

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
                console.log('loadSession response:', data);

                // Update state with loaded data
                this.state.session.uuid = uuid;
                this.state.session.loaded = true;

                if (data.character_config) {
                    this.state.character = data.character_config;

                    // Build items state from character's owned_items
                    this.state.items = {};

                    console.log('character_config.owned_items:', data.character_config.owned_items);
                    console.log('character_config.gear:', data.character_config.gear);

                    // Add owned items (inventory + bank)
                    if (data.character_config.owned_items) {
                        data.character_config.owned_items.forEach(itemId => {
                            // Strip quality suffix for crafted items
                            // e.g., "kelp_diving_mask_uncommon" -> "kelp_diving_mask"
                            const qualities = ['_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal'];
                            let baseId = itemId;
                            let quality = null;  // Don't set quality for non-crafted items

                            for (const qualitySuffix of qualities) {
                                if (itemId.endsWith(qualitySuffix)) {
                                    baseId = itemId.slice(0, -qualitySuffix.length);
                                    quality = qualitySuffix.slice(1); // Remove leading underscore
                                    break;
                                }
                            }

                            // Only set quality if it was found in the suffix (crafted item)
                            if (quality) {
                                this.state.items[baseId] = {
                                    has: true,
                                    hide: false,
                                    quality: quality
                                };
                            } else {
                                this.state.items[baseId] = {
                                    has: true,
                                    hide: false
                                };
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
                            // statFilter is NOT persisted - always reset to 'None'
                            statFilter: 'None',
                            expandedStats: []
                        }
                    };

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
        $.get(`/api/session/${uuid}/gearsets`)
            .done((gearSets) => {
                console.log('Loaded gear sets:', gearSets);

                // Convert array to object keyed by id
                this.state.gearsets.saved = {};
                gearSets.forEach(gearSet => {
                    this.state.gearsets.saved[gearSet.id] = {
                        name: gearSet.name,
                        slots: gearSet.slots_json,
                        export_string: gearSet.export_string,  // Store export string for optimized gearsets
                        is_optimized: gearSet.is_optimized
                    };
                });

                this._notifySubscribers('gearsets.saved');
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
        // Update local state
        this.state.gearsets.current[slot] = item;

        // Notify subscribers
        // Note: Only notify the specific slot path - parent path subscribers
        // (like 'gearsets.current') will be automatically notified by _notifySubscribers
        this._notifySubscribers(`gearsets.current.${slot}`);

        // Auto-save current gear to backend
        this._saveCurrentGear();
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
            console.log('Auto-saving current gear:', this.state.gearsets.current);

            $.ajax({
                url: `/api/session/${this.state.session.uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({
                    path: 'ui.currentGear',
                    value: this.state.gearsets.current
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
     * Save a named gear set to backend
     * @param {string} name - Gear set name
     * @param {string|null} id - Existing gear set ID (for updates)
     * @returns {Promise} jQuery promise
     */
    saveGearSet(name, id = null) {
        if (!this.state.session.loaded || !this.state.session.uuid) {
            return $.Deferred().reject('Session not loaded').promise();
        }

        const data = {
            name: name,
            slots: { ...this.state.gearsets.current }
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
            this.state.gearsets.selectedId = gearSet.id;
            this.state.gearsets.selectedName = gearSet.name;

            this._notifySubscribers('gearsets.saved');
            this._notifySubscribers('gearsets.selectedId');
            this._notifySubscribers('gearsets.selectedName');
        });
    }

    /**
     * Load a saved gear set into current gear
     * @param {string} id - Gear set ID
     */
    loadGearSet(id) {
        const gearSet = this.state.gearsets.saved[id];
        if (!gearSet) {
            console.error('Gear set not found:', id);
            return;
        }

        // If this is an optimized gearset with export_string, decode it
        if (gearSet.export_string && gearSet.is_optimized) {
            console.log('Loading optimized gearset, decoding export string...');
            // Pass slots data so consumable can be merged after decoding
            this.loadGearSetFromExport(gearSet.export_string, id, gearSet.name, gearSet.slots);
        } else {
            // Regular gearset - use slots directly
            this.state.gearsets.current = { ...gearSet.slots };
            this.state.gearsets.selectedId = id;
            this.state.gearsets.selectedName = gearSet.name;

            // Notify subscribers
            this._notifySubscribers('gearsets.current');
            this._notifySubscribers('gearsets.selectedId');
            this._notifySubscribers('gearsets.selectedName');

            // Auto-save the loaded gear as current
            this._saveCurrentGear();
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

                        // Clone and set quality, and add itemId field for compatibility
                        const enrichedItem = {
                            ...fullItem,
                            itemId: fullItem.id,  // Add itemId field for combined-stats-section compatibility
                            quality: qualityName,
                            rarity: itemQuality
                        };

                        slots[finalSlotName] = enrichedItem;
                        console.log(`  Enriched ${finalSlotName}: ${fullItem.name} (crafted, quality: ${qualityName})`);
                    } else {
                        // Non-crafted item, add itemId field for compatibility
                        const enrichedItem = {
                            ...fullItem,
                            itemId: fullItem.id  // Add itemId field for combined-stats-section compatibility
                        };

                        slots[finalSlotName] = enrichedItem;
                        console.log(`  Enriched ${finalSlotName}: ${fullItem.name} (rarity: ${fullItem.rarity})`);
                    }
                } else {
                    console.warn('Item not found in catalog:', itemData.id);
                }
            }

            console.log('Decoded and enriched gearset, total slots:', Object.keys(slots).length);

            // Merge extra slot data (e.g., consumable from optimization)
            if (extraSlots) {
                for (const [slotName, slotData] of Object.entries(extraSlots)) {
                    if (slotData && !slots[slotName]) {
                        slots[slotName] = slotData;
                        console.log(`  Merged extra slot ${slotName}: ${slotData.name || 'unknown'}`);
                    }
                }
            }

            // Update state
            this.state.gearsets.current = slots;
            this.state.gearsets.selectedId = id;
            this.state.gearsets.selectedName = name;

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
     * Unequip all gear slots
     */
    unequipAll() {
        // Clear all slots
        const slots = Object.keys(this.state.gearsets.current);
        slots.forEach(slot => {
            this.state.gearsets.current[slot] = null;
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
