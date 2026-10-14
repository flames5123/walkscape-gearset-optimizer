/**
 * API Client - Backend Communication with jQuery AJAX
 * 
 * Wraps all backend API calls with consistent error handling
 * and toast notifications.
 */

import { runLocalCompute, isLocalComputeEnabled, runStatsReportLocal, runCraftingTreeOptimizeLocal, runCraftingTreeOptimizeLocalParallel, runFastestCraftLocal } from './local-compute.js';

class ApiClient {
    constructor() {
        this.baseUrl = '/api';
        this._catalogCache = null;
        this._catalogPromise = null;
    }

    /**
     * GET session data
     * @param {string} uuid - Session UUID
     * @returns {Promise} jQuery promise with session data
     */
    getSession(uuid) {
        return $.get(`${this.baseUrl}/session/${uuid}`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load session');
            });
    }

    /**
     * POST import character data
     * @param {string} uuid - Session UUID
     * @param {string} exportJson - Character export JSON string
     * @returns {Promise} jQuery promise
     */
    importCharacter(uuid, exportJson) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/import`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ export_json: exportJson })
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to import character data');
        });
    }

    /**
     * GET export character config in game export format
     * @param {string} uuid - Session UUID
     * @returns {Promise} jQuery promise resolving to {success, export}
     */
    exportCharacterConfig(uuid) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/export`,
            method: 'GET'
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to export character config');
        });
    }

    /**
     * PATCH update config
     * @param {string} uuid - Session UUID
     * @param {string} path - Config path (e.g., "skills.mining")
     * @param {*} value - New value
     * @returns {Promise} jQuery promise
     */
    updateConfig(uuid, path, value) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/config`,
            method: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ path, value })
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to update configuration');
        });
    }

    /**
     * POST trigger recalculations
     * @param {string} uuid - Session UUID
     * @returns {Promise} jQuery promise
     */
    calculate(uuid) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/calculate`,
            method: 'POST',
            contentType: 'application/json'
        }).fail((xhr, status, error) => {
            this.handleError(xhr, 'Failed to run calculations');
        });
    }

    /**
     * GET items catalog
     * @returns {Promise} jQuery promise with items data
     */
    getItems() {
        return $.get(`${this.baseUrl}/items`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load items catalog');
            });
    }

    /**
     * GET skills definitions
     * @returns {Promise} jQuery promise with skills data
     */
    getSkills() {
        return $.get(`${this.baseUrl}/skills`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load skills');
            });
    }

    /**
     * GET custom stats options
     * @returns {Promise} jQuery promise with custom stats options
     */
    getCustomStats() {
        return $.get(`${this.baseUrl}/custom-stats`)
            .fail((xhr, status, error) => {
                this.handleError(xhr, 'Failed to load custom stats options');
            });
    }

    /**
     * GET catalog (items with full details)
     * Cached — catalog data doesn't change during a session.
     * Call invalidateCatalog() after character import to refresh.
     * @returns {Promise} jQuery promise with catalog data
     */
    getCatalog() {
        // Return cached data if available
        if (this._catalogCache) {
            return $.Deferred().resolve(this._catalogCache).promise();
        }

        // If a request is already in flight, return that promise
        if (this._catalogPromise) {
            return this._catalogPromise;
        }

        // Make the request and cache the result
        this._catalogPromise = $.get(`${this.baseUrl}/catalog`)
            .done((data) => {
                this._catalogCache = data;
                this._catalogPromise = null;
            })
            .fail((xhr, status, error) => {
                this._catalogPromise = null;
                this.handleError(xhr, 'Failed to load catalog');
            });

        return this._catalogPromise;
    }

    /**
     * Get item sources (activities that drop, recipes that produce/consume)
     * @returns {Promise} jQuery promise with item sources data
     */
    getItemSources() {
        if (this._itemSourcesCache) {
            return $.Deferred().resolve(this._itemSourcesCache).promise();
        }
        if (this._itemSourcesPromise) {
            return this._itemSourcesPromise;
        }
        this._itemSourcesPromise = $.get(`${this.baseUrl}/item-sources`)
            .done((data) => {
                this._itemSourcesCache = data;
                this._itemSourcesPromise = null;
            })
            .fail((xhr, status, error) => {
                this._itemSourcesPromise = null;
                console.error('Failed to load item sources:', error);
            });
        return this._itemSourcesPromise;
    }

    /**
     * Get full details for a container (chest) — drops grouped by rarity table.
     * Results are memoized per container name.
     * @param {string} containerName - Display name, e.g. "Agility chest"
     * @returns {Promise<Object>} container details {name, container_type, rolls_per_chest, tables}
     */
    getContainerDetails(containerName) {
        if (!this._containerCache) this._containerCache = new Map();
        const key = (containerName || '').toLowerCase().trim();
        if (this._containerCache.has(key)) {
            return Promise.resolve(this._containerCache.get(key));
        }
        return fetch(`${this.baseUrl}/container/${encodeURIComponent(containerName)}`)
            .then(resp => {
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return resp.json();
            })
            .then(data => {
                this._containerCache.set(key, data);
                return data;
            })
            .catch(err => {
                console.error(`Failed to load container "${containerName}":`, err);
                return null;
            });
    }

    /**
     * Invalidate the catalog cache (call after character import)
     */
    invalidateCatalog() {
        this._catalogCache = null;
        this._catalogPromise = null;
    }

    /**
     * Error handler wrapper
     * @param {Object} xhr - jQuery XHR object
     * @param {string} defaultMessage - Default error message
     */
    handleError(xhr, defaultMessage) {
        let message = defaultMessage;

        // Try to extract error message from response
        if (xhr.responseJSON && xhr.responseJSON.message) {
            message = xhr.responseJSON.message;
        } else if (xhr.responseJSON && xhr.responseJSON.error) {
            message = xhr.responseJSON.error;
        } else if (xhr.responseText) {
            try {
                const response = JSON.parse(xhr.responseText);
                if (response.message) {
                    message = response.message;
                } else if (response.detail) {
                    message = response.detail;
                }
            } catch (e) {
                // Not JSON, use default message
            }
        }

        // Add status code if available
        if (xhr.status && xhr.status !== 0) {
            message = `${message} (${xhr.status})`;
        }

        this.showError(message);
    }

    /**
     * Show error toast notification (red)
     * @param {string} message - Error message to display
     * @param {Object} options - Options: duration, onClick, html
     */
    showError(message, options = {}) {
        const duration = options.duration || 5000;
        const onClick = options.onClick || null;

        // Remove any existing error toasts
        $('.error-toast').remove();

        // Funnel into the debug log so the next bug report has context on
        // what triggered the toast. Skips lazy no-op fallback if the
        // recorder isn't installed yet (main.js-imports may still be in
        // flight on first paint).
        try {
            if (typeof window !== 'undefined' && window.__walkscapeRecordError && (message || options.html)) {
                window.__walkscapeRecordError('api.showError', new Error(String(message || options.html)));
            }
        } catch (_e) { /* noop */ }

        // Create new error toast (use html() if HTML content provided)
        const $toast = $('<div class="error-toast"></div>');
        if (options.html) {
            $toast.html(options.html);
        } else {
            $toast.text(message);
        }
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss
        const dismissTimer = setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, duration);

        // Allow manual dismiss by clicking
        $toast.on('click', () => {
            clearTimeout(dismissTimer);
            if (onClick) {
                onClick();
            }
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }

    /**
     * Show success toast notification
     * @param {string} message - Success message to display
     */
    showSuccess(message, options = {}) {
        const duration = options.duration || 3000;
        const onClick = options.onClick || null;

        // Remove any existing success toasts
        $('.success-toast').remove();

        // Create new success toast (use html() if HTML content provided)
        const $toast = $('<div class="success-toast"></div>');
        if (options.html) {
            $toast.html(options.html);
        } else {
            $toast.text(message);
        }
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss
        const dismissTimer = setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, duration);

        // Click handler
        $toast.on('click', () => {
            clearTimeout(dismissTimer);
            if (onClick) {
                onClick();
            }
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }

    /**
     * Show info toast notification
     * @param {string} message - Info message to display
     */
    showInfo(message, options = {}) {
        const duration = options.duration || 4000;
        const onClick = options.onClick || null;

        // Remove any existing info toasts
        $('.info-toast').remove();

        // Create new info toast
        const $toast = $('<div class="info-toast"></div>');
        if (options.html) {
            $toast.html(options.html);
        } else {
            $toast.text(message);
        }
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss
        const dismissTimer = setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, duration);

        // Click handler
        $toast.on('click', () => {
            clearTimeout(dismissTimer);
            if (onClick) {
                onClick();
            }
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }

    /**
     * Show warning toast notification (yellow)
     * @param {string} message - Warning message to display
     * @param {Object} options - Options: duration, onClick, html
     */
    showWarning(message, options = {}) {
        const duration = options.duration || 8000;
        const onClick = options.onClick || null;

        // Remove any existing warning toasts
        $('.warning-toast').remove();

        // Create new warning toast
        const $toast = $('<div class="warning-toast"></div>');
        if (options.html) {
            $toast.html(options.html);
        } else {
            $toast.text(message);
        }
        $('body').append($toast);

        // Fade in
        $toast.fadeIn(300);

        // Auto-dismiss
        const dismissTimer = setTimeout(() => {
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        }, duration);

        // Click handler
        $toast.on('click', () => {
            clearTimeout(dismissTimer);
            if (onClick) {
                onClick();
            }
            $toast.fadeOut(300, () => {
                $toast.remove();
            });
        });
    }
    // ================================================================
    // GENERIC DEFINITIONS
    // ================================================================

    getGenericDefinitions(uuid) {
        return $.get(`${this.baseUrl}/generic-definitions/${uuid}`)
            .fail((xhr) => this.handleError(xhr, 'Failed to load generic definitions'));
    }

    saveGenericDefinition(uuid, data) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definitions/${uuid}`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).fail((xhr) => this.handleError(xhr, 'Failed to save generic definition'));
    }

    updateGenericDefinition(uuid, defId, data) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definitions/${uuid}/${defId}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).fail((xhr) => this.handleError(xhr, 'Failed to update generic definition'));
    }

    deleteGenericDefinition(uuid, defId, type) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definitions/${uuid}/${defId}?type=${type}`,
            method: 'DELETE'
        }).fail((xhr) => this.handleError(xhr, 'Failed to delete generic definition'));
    }

    toggleGenericSharing(uuid, defId, type, isPublic) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definitions/${uuid}/${defId}/share`,
            method: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ type, is_public: isPublic })
        }).fail((xhr) => this.handleError(xhr, 'Failed to toggle sharing'));
    }

    getCommunityDefinitions() {
        return $.get(`${this.baseUrl}/generic-definitions/community`)
            .fail((xhr) => this.handleError(xhr, 'Failed to load community definitions'));
    }

    getCustomKeywords() {
        return $.get(`${this.baseUrl}/custom-keywords`)
            .fail((xhr) => this.handleError(xhr, 'Failed to load custom keywords'));
    }

    saveCustomKeyword(name, icon = '🏷️', banned = true, icon_color = null) {
        return $.ajax({
            url: `${this.baseUrl}/custom-keywords`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name, icon, banned, icon_color })
        }).fail((xhr) => this.handleError(xhr, 'Failed to save custom keyword'));
    }

    cloneGenericDefinition(uuid, type, defId) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definitions/${uuid}/clone`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ type, id: defId })
        }).fail((xhr) => this.handleError(xhr, 'Failed to clone definition'));
    }

    reverseCalculate(data) {
        return $.ajax({
            url: `${this.baseUrl}/reverse-calculate`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).fail((xhr) => this.handleError(xhr, 'Failed to reverse calculate'));
    }

    getCalibrationGearset(data) {
        return $.ajax({
            url: `${this.baseUrl}/calibration-gearset`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).fail((xhr) => this.handleError(xhr, 'Failed to build calibration gearset'));
    }

    // ================================================================
    // GOOGLE SHEETS SYNC
    // ================================================================

    getSheetsSyncStatus() {
        return $.get(`${this.baseUrl}/sheets-sync/status`)
            .fail((xhr) => this.handleError(xhr, 'Failed to get sync status'));
    }

    refreshSheetsSync() {
        return $.ajax({
            url: `${this.baseUrl}/sheets-sync/refresh`,
            method: 'POST'
        }).fail((xhr) => this.handleError(xhr, 'Failed to refresh sync'));
    }

    pauseSheetsSync(paused) {
        return $.ajax({
            url: `${this.baseUrl}/sheets-sync/pause`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ paused })
        }).fail((xhr) => this.handleError(xhr, 'Failed to toggle sync pause'));
    }

    getXpCalibrationGearset(data) {
        return $.ajax({
            url: `${this.baseUrl}/xp-calibration-gearset`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).fail((xhr) => this.handleError(xhr, 'Failed to build XP calibration gearset'));
    }

    getGenericDefinitionView(defId) {
        return $.ajax({
            url: `${this.baseUrl}/generic-definition-view/${defId}`,
            method: 'GET'
        }).fail((xhr) => this.handleError(xhr, 'Failed to load generic definition'));
    }

    // ========================================================================
    // CRAFTING TREE CALCULATOR
    // ========================================================================

    getCraftableItems() {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/items`,
            method: 'GET'
        }).fail((xhr) => this.handleError(xhr, 'Failed to load craftable items'));
    }

    buildCraftingTree(itemId, sessionUuid, spoilerProtection = true) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/build`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                item_id: itemId,
                session_uuid: sessionUuid,
                spoiler_protection: spoilerProtection
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to build crafting tree'));
    }

    calculateCraftingTree(nodes, globalSettings, sessionUuid) {
        // Client-side (Pyodide) path: compute the tree in the browser when the
        // FAC + toggle are on. The server still enriches session_data (regions,
        // LP flag) via a run_local handshake; the heavy calculate_tree runs locally.
        if (isLocalComputeEnabled() && Array.isArray(nodes) && nodes.length) {
            return this._calculateCraftingTreeLocal(nodes, globalSettings, sessionUuid);
        }
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/calculate`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                global_settings: globalSettings,
                session_uuid: sessionUuid
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to calculate crafting tree'));
    }

    async _calculateCraftingTreeLocal(nodes, globalSettings, sessionUuid) {
        const serverCalc = () => $.ajax({
            url: `${this.baseUrl}/crafting-tree/calculate`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                global_settings: globalSettings,
                session_uuid: sessionUuid
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to calculate crafting tree'));

        // 1. Handshake: server returns enriched session_data (needs DB + LP flag).
        //    If the FAC is off server-side it computes normally and we use that.
        let handshake;
        try {
            handshake = await $.ajax({
                url: `${this.baseUrl}/crafting-tree/calculate`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    nodes: nodes,
                    global_settings: globalSettings,
                    session_uuid: sessionUuid,
                    run_local: true
                })
            });
        } catch (e) {
            return serverCalc(); // handshake failed — just compute on the server
        }

        if (!handshake || !handshake.run_local) {
            return handshake; // server computed it (FAC off or fallback)
        }

        // Holistic Mode (LP) uses scipy.optimize.linprog, which is NOT available
        // in the Pyodide worker — compute LP trees on the server.
        const sd = handshake.session_data || {};
        if (sd._lp_enabled) {
            console.log('[local-tree] Holistic Mode (LP) on — computing on server (scipy not in browser)');
            return serverCalc();
        }

        // 2. Compute locally; fall back to the server on ANY local failure so a
        //    browser-side error never blocks the user with an alert.
        try {
            return await runLocalCompute('crafting-tree-calc', {
                nodes: nodes,
                global_settings: globalSettings,
                session_data: handshake.session_data
            });
        } catch (e) {
            console.error('[local-tree] local compute failed, falling back to server:', e);
            return serverCalc();
        }
    }

    aggregateCraftingTreeSummary(nodes, globalSettings, sessionUuid) {
        // Pure aggregation — no per-node recompute, no LP, no optimizer.
        // Used by the manual "Rerun Summary" button so the result is
        // deterministic for a fixed tree state.
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/aggregate-summary`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                global_settings: globalSettings,
                session_uuid: sessionUuid
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to rerun summary'));
    }

    craftingTreeSourceChange(nodes, nodeId, newSource, sessionUuid, spoilerProtection = true) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/source-change`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                node_id: nodeId,
                new_source: newSource,
                session_uuid: sessionUuid,
                spoiler_protection: spoilerProtection
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to change source'));
    }

    craftingTreeMaterialGroupChange(nodes, nodeId, groupIndex, sessionUuid, spoilerProtection = true, globalSettings = {}) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/material-group-change`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                node_id: nodeId,
                group_index: groupIndex,
                session_uuid: sessionUuid,
                spoiler_protection: spoilerProtection,
                global_settings: globalSettings,
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to change material group'));
    }

    optimizeCraftingTree(nodes, globalSettings, sessionUuid, nodeIds = null, depthOptimize = false) {
        // When the local_optimization FAC + toggle are on, run the optimize in
        // the browser (Pyodide) via a run_local handshake; the heavy per-node
        // optimization runs locally. Falls back to the server on any failure.
        if (isLocalComputeEnabled()) {
            return this._optimizeCraftingTreeLocal(nodes, globalSettings, sessionUuid, nodeIds, depthOptimize);
        }
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/optimize`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                nodes: nodes,
                global_settings: globalSettings,
                session_uuid: sessionUuid,
                node_ids: nodeIds,
                depth_optimize: depthOptimize
            })
        }).fail((xhr) => this.handleError(xhr, 'Failed to start optimization'));
    }

    async _optimizeCraftingTreeLocal(nodes, globalSettings, sessionUuid, nodeIds, depthOptimize) {
        const body = {
            nodes: nodes,
            global_settings: globalSettings,
            session_uuid: sessionUuid,
            node_ids: nodeIds,
            depth_optimize: depthOptimize,
        };
        const serverRun = () => $.ajax({
            url: `${this.baseUrl}/crafting-tree/optimize`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(body),
        }).fail((xhr) => this.handleError(xhr, 'Failed to start optimization'));

        // Handshake: server creates the task record (status=running) + returns
        // the session payload so the browser can run the shared core locally.
        let handshake;
        try {
            handshake = await $.ajax({
                url: `${this.baseUrl}/crafting-tree/optimize`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(Object.assign({}, body, { run_local: true })),
            });
        } catch (e) {
            return serverRun(); // handshake failed — run on the server
        }
        if (!handshake || !handshake.run_local) {
            return handshake; // server ran it (FAC off server-side)
        }

        // Fire-and-forget the local run (subtree-parallel; falls back to a
        // single worker for small/unsplittable trees, and to a server run on
        // any failure). It POSTs results to /crafting-tree/optimize-local-result,
        // which drives the existing optimize-status poll.
        runCraftingTreeOptimizeLocalParallel({
            optimization_id: handshake.optimization_id,
            session_uuid: sessionUuid,
            nodes: nodes,
            global_settings: globalSettings,
            session_data: handshake.session_data,
            ui_config: handshake.ui_config,
            node_ids: nodeIds,
            depth_optimize: depthOptimize,
        }).catch((e) => {
            console.error('[local-tree-opt] run failed, falling back to server:', e);
            try { serverRun(); } catch (_e) { /* ignore */ }
        });

        // Return immediately so the page starts polling /optimize-status.
        return { optimization_id: handshake.optimization_id };
    }

    getCraftingTreeOptimizeStatus(sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/optimize-status`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        }).fail((xhr) => this.handleError(xhr, 'Failed to get optimization status'));
    }

    cancelCraftingTreeOptimize(sessionUuid) {
        // Cooperative cancel — the server flips task["cancelled"] and the core
        // stops at the next node boundary (see /api/crafting-tree/optimize-cancel).
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/optimize-cancel`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ session_uuid: sessionUuid })
        }).fail((xhr) => this.handleError(xhr, 'Failed to cancel optimization'));
    }

    listSavedCraftingTrees(sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/saved`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        });
    }

    saveCraftingTree(sessionUuid, name, targetItemId, treeData) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/saved`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ session_uuid: sessionUuid, name, target_item_id: targetItemId, tree_data: treeData })
        }).fail((xhr) => this.handleError(xhr, 'Failed to save crafting tree'));
    }

    loadSavedCraftingTree(treeId, sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/saved/${treeId}`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        }).fail((xhr) => this.handleError(xhr, 'Failed to load crafting tree'));
    }

    deleteSavedCraftingTree(treeId, sessionUuid) {
        // jQuery sends $.ajax `data` in the body for DELETE requests, but the
        // backend reads session_uuid from query params, so put it in the URL.
        const qs = $.param({ session_uuid: sessionUuid });
        return $.ajax({
            url: `${this.baseUrl}/crafting-tree/saved/${treeId}?${qs}`,
            method: 'DELETE'
        }).fail((xhr) => this.handleError(xhr, 'Failed to delete crafting tree'));
    }

    // ---- Item Upgrades Tracker (FAC: upgrades_tracker) --------------------

    getUpgradesTrackerWorking(sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/working`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        });
    }

    saveUpgradesTrackerWorking(sessionUuid, entries) {
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/working`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({ session_uuid: sessionUuid, entries })
        }).fail(() => {});  // silent: FAC-gated feature — never surface a "not enabled" toast
    }

    listUpgradesTrackers(sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/list`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        }).fail(() => {});
    }

    saveUpgradesTracker(sessionUuid, name, entries, id = null) {
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/save`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ session_uuid: sessionUuid, name, entries, id })
        }).fail(() => {});
    }

    loadUpgradesTracker(trackerId, sessionUuid) {
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/load/${trackerId}`,
            method: 'GET',
            data: { session_uuid: sessionUuid }
        }).fail(() => {});
    }

    deleteUpgradesTracker(trackerId, sessionUuid) {
        const qs = $.param({ session_uuid: sessionUuid });
        return $.ajax({
            url: `${this.baseUrl}/upgrades-tracker/${trackerId}?${qs}`,
            method: 'DELETE'
        }).fail(() => {});
    }

    getDuplicateGearSets(uuid) {
        return $.ajax({
            url: `${this.baseUrl}/gear-sets/${uuid}/duplicates`,
            method: 'GET'
        }).fail((xhr) => this.handleError(xhr, 'Failed to detect duplicate gear sets'));
    }

    cleanupGearSets(uuid, ids) {
        return $.ajax({
            url: `${this.baseUrl}/gear-sets/${uuid}/cleanup`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ ids })
        }).fail((xhr) => this.handleError(xhr, 'Failed to clean up gear sets'));
    }

    dismissGearSetSuggest(uuid, gearSetId) {
        return $.ajax({
            url: `${this.baseUrl}/session/${uuid}/gearsets/${gearSetId}/suggest-dismiss`,
            method: 'POST',
            contentType: 'application/json'
        }).fail((xhr) => this.handleError(xhr, 'Failed to dismiss gear set suggestion'));
    }

    // Color theme presets
    getColorPresets() {
        return $.get(`${this.baseUrl}/color-presets`)
            .fail((xhr) => this.handleError(xhr, 'Failed to load color presets'));
    }

    saveColorPreset(name, lineColors, customColors, id = null) {
        return $.ajax({
            url: `${this.baseUrl}/color-presets`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name, lineColors, customColors, id })
        }).fail((xhr) => this.handleError(xhr, 'Failed to save color preset'));
    }

    deleteColorPreset(presetId) {
        return $.ajax({
            url: `${this.baseUrl}/color-presets/${presetId}`,
            method: 'DELETE'
        }).fail((xhr) => this.handleError(xhr, 'Failed to delete color preset'));
    }

    // ========================================================================
    // STATS REPORT
    // ========================================================================

    /**
     * Start a new stats report bulk optimization run.
     * @param {string} uuid - Session UUID
     * @param {string[]} categories - Categories to run: 'xp', 'new_items', 'chests', 'coins'
     * @param {string[]} skills - Skill names to include (empty = all skills)
     * @param {boolean} notify - Whether to send push notification on completion
     * @param {object} [opts] - Optional flags: { include_pets, include_consumables }
     * @returns {Promise} { success, run_id, total_jobs }
     */
    startStatsReportRun(uuid, categories, skills, notify, opts) {
        const body = {
            categories,
            skills,
            notify_on_complete: notify,
            include_pets: !!(opts && opts.include_pets),
            include_consumables: !!(opts && opts.include_consumables),
            // 2026-09-23 (jwbail): report-local Consumable Options. These were
            // passed in `opts` by stats-report-page but never copied into the
            // run body, so both the server (/stats-report/run) and the local
            // Pyodide worker fell back to their defaults (min-owned DISABLED),
            // and the "ignore < X owned" filter silently did nothing — it
            // selected consumables the user owns fewer than X of (e.g. Fried
            // noodles at 4 owned with threshold 5). Forward all five so the
            // optimizer's _collect_owned_consumables actually applies them.
            include_fine_consumables: (opts && opts.include_fine_consumables !== undefined)
                ? !!opts.include_fine_consumables : true,
            consumable_min_owned_enabled: !!(opts && opts.consumable_min_owned_enabled),
            consumable_min_owned: (opts && Number.isFinite(opts.consumable_min_owned))
                ? opts.consumable_min_owned : 5,
            consumable_min_owned_operator: (opts && opts.consumable_min_owned_operator === 'lte')
                ? 'lte' : 'lt',
            consumable_use_hidden: !!(opts && opts.consumable_use_hidden),
            // 2026-08-31 (jwbail): "Always use active applicable pet ability"
            // toggle. Merges each candidate pet's active adult-level ability
            // stats into scoring and marks the equipped pet for column-2's
            // "use ability" box. Default false for older clients.
            use_pet_ability: !!(opts && opts.use_pet_ability),
            stale_only: !!(opts && opts.stale_only),
            // 2026-05-22 (T17 follow-up): WTO sub-filter for new_items.
            // Subset of ['gear','tools','eggs','collectibles']. Worker
            // filters new_items jobs to only the selected kinds.
            kinds: (opts && Array.isArray(opts.kinds)) ? opts.kinds : ['gear', 'tools', 'eggs', 'collectibles'],
            // 2026-08-11 (jwbail): WTO sub-filter for target_items. List of
            // target-category slugs (gems, normal_items, fine_items, etc.)
            // selected in the "Fastest Target Item Activities" panel. Worker
            // filters build_target_items_jobs to only the requested categories.
            // null/missing = all categories (preserves prior behavior).
            target_categories: (opts && Array.isArray(opts.target_categories)) ? opts.target_categories : null,
            // 2026-08-12 (jwbail): v2 include_fine toggle. When true, target_items
            // includes fine variants as separate leaves and adds fine sell value
            // to currency groups.
            include_fine: !!(opts && opts.include_fine),
            // Fastest Craft: crafted pill categories to solve (empty = all).
            fastest_craft_categories: (opts && Array.isArray(opts.fastest_craft_categories))
                ? opts.fastest_craft_categories : [],
            // 2026-06-02 (jwbail): WTO chest filter. List of chest names
            // selected in the chests / chests_recipes WTO panels. Worker
            // filters build_chest_jobs and build_chests_recipes_jobs
            // output to only the requested chests. Empty/missing means
            // "all chests" (preserves prior behavior for clients that
            // don't send the field). User-reported bug: ticking only
            // one chest still showed 236 chests in the run total
            // because the field wasn't being sent at all.
            chests: (opts && Array.isArray(opts.chests)) ? opts.chests : null,
            // 2026-06-16 (jwbail): per-category skill/chest selections so XP vs
            // Coins and Chests vs Chests-recipes can be tuned independently.
            // Worker applies each category's own list; absent key falls back to
            // the flat skills/chests above.
            skills_by_category: (opts && opts.skills_by_category) ? opts.skills_by_category : null,
            chests_by_category: (opts && opts.chests_by_category) ? opts.chests_by_category : null,
            // 2026-05-23 testing flag: skip local-search refinement.
            fast: !!(opts && opts.fast),
            // 2026-07-11 (jwbail): "today's changes" old/new toggle (gated
            // session 20a57b65). Boolean when the checkbox is shown; null means
            // "not provided" so the optimizer keeps its default.
            exact_new: (opts && typeof opts.exact_new === 'boolean') ? opts.exact_new : null,
            // 2026-10-01 (jwbail): report-local "Include unavailable" dimensions.
            // Raw master + per-dimension sub-flags; the server (/stats-report/run)
            // derives the EFFECTIVE map and both the server worker and the local
            // Pyodide worker gate on it. Defaults preserve legacy behavior
            // (inputs included-with-warning, everything else hidden).
            include_unavailable: !!(opts && opts.include_unavailable),
            unavail_by_level: !!(opts && opts.unavail_by_level),
            unavail_by_location: !!(opts && opts.unavail_by_location),
            unavail_by_gear: !!(opts && opts.unavail_by_gear),
            unavail_by_inputs: (opts && opts.unavail_by_inputs !== undefined)
                ? !!opts.unavail_by_inputs : true,
            unavail_by_other: !!(opts && opts.unavail_by_other),
        };
        if (isLocalComputeEnabled()) {
            return this._startStatsReportRunLocal(body);
        }
        return $.ajax({
            url: `${this.baseUrl}/stats-report/run`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(body)
        }).fail((xhr) => this.handleError(xhr, 'Failed to start goals report run'));
    }

    async _startStatsReportRunLocal(body) {
        const serverRun = () => $.ajax({
            url: `${this.baseUrl}/stats-report/run`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(body)
        }).fail((xhr) => this.handleError(xhr, 'Failed to start goals report run'));

        // Handshake: server creates the run record + caches jobs, and returns
        // the session + params so the browser can run jobs locally.
        let resp;
        try {
            resp = await $.ajax({
                url: `${this.baseUrl}/stats-report/run`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(Object.assign({}, body, { run_local: true }))
            });
        } catch (e) {
            return serverRun(); // handshake failed — run on the server
        }
        if (!resp || !resp.run_local) {
            return resp; // server ran it (FAC off server-side)
        }

        // Fire-and-forget the local run(s). The regular goals-report worker
        // POSTs each scope to /stats-report/local-scope; Steps per Recipe
        // (fastest_craft) computes on-device and POSTs its details to
        // /api/fastest-craft/local-result. Both run CONCURRENTLY in Pyodide,
        // each with its own (done,total); we sum them into ONE progress bar so
        // an FC-only run never shows the regular pass's 0/0, and a mixed run
        // advances across both. statsReportLocalRunFinished fires once BOTH
        // settle, so the page's final reconcile picks up the persisted FC rows.
        // `completed` carries the NON-stale scopes the server already filtered
        // out (stale_only parity); the worker's _sr_build drops these.
        const _fcChips = Array.isArray(body.fastest_craft_categories) ? body.fastest_craft_categories : [];
        const _hasFC = Array.isArray(body.categories)
            && body.categories.indexOf('fastest_craft') !== -1 && _fcChips.length > 0;
        let _regDone = 0, _regTotal = 0, _fcDone = 0, _fcTotal = 0;
        const _emitCombined = () => {
            try {
                window.dispatchEvent(new CustomEvent('statsReportLocalProgress',
                    { detail: { done: _regDone + _fcDone, total: _regTotal + _fcTotal } }));
            } catch (e) { /* ignore */ }
        };

        const _regularP = runStatsReportLocal(
            { run_params: resp.run_params, session: resp.session, completed: resp.completed || [], jobCountHint: resp.total_jobs },
            (done, total) => { _regDone = done; _regTotal = total; _emitCombined(); }
        ).catch((e) => {
            console.error('[local-goals] run failed:', e);
            if (this.showError) this.showError('Local goals report failed: ' + (e && e.message ? e.message : e));
        });

        let _fcP = Promise.resolve();
        if (_hasFC) {
            const _sess = resp.session || {};
            _fcP = runFastestCraftLocal(
                {
                    session_uuid: _sess.session_uuid || _sess.uuid || '',
                    selected_ids: _fcChips,
                    session_data: _sess.character_config || {},
                    ui_config: _sess.ui_config || {},
                },
                (done, total) => { _fcDone = done; _fcTotal = total; _emitCombined(); }
            ).catch((e) => {
                console.error('[local-fc] run failed:', e);
                if (this.showError) this.showError('Local Steps per Recipe failed: ' + (e && e.message ? e.message : e));
            });
        }

        Promise.all([_regularP, _fcP]).finally(() => {
            // Both the regular goals worker and FC have drained their POSTs
            // (incl. FC's /local-result persist). The page resumes polling and
            // reconciles, so the complete report — including the now-persisted
            // FC rows — paints without a manual reload.
            try { window.dispatchEvent(new CustomEvent('statsReportLocalRunFinished')); } catch (_) { /* ignore */ }
        });

        // Return immediately so the page starts polling /status as scopes land.
        return { success: true, run_id: resp.run_id, total_jobs: resp.total_jobs };
    }

    /**
     * Get the current stats report run status for the session.
     * @param {string} uuid - Session UUID (unused, session from cookie)
     * @returns {Promise} { success, run_id, status, total_jobs, completed_jobs, failed_jobs, is_complete, is_stale, started_at, completed_at }
     */
    getStatsReportStatus(uuid, runId) {
        // No .fail() toast: this is polled every couple seconds, so a transient
        // server blip (e.g. a deploy 502) must NOT spam error toasts. Callers
        // (_pollProgress / _loadInitialStatus) handle failures gracefully and
        // show a single "Lost connection ... will retry" message after several
        // misses.
        // runId (optional): scope the status to the run the caller is tracking
        // so a stale prior run (e.g. an old failed run) can't hijack the UI.
        const q = runId ? ('?run_id=' + encodeURIComponent(runId)) : '';
        return $.get(`${this.baseUrl}/stats-report/status${q}`);
    }

    /**
     * Force-finalize a stuck local (Pyodide) goals-report run.
     *
     * Re-fires the same /local-complete the browser sends at the end of a local
     * run. The server's finalize is idempotent: it only completes a run still
     * in status 'running' (guarded inside _finalize_local_stats_report_run /
     * the /local-complete handler), so calling this on an already-complete run
     * is a harmless no-op. Used by the "Finishing…" watchdog in
     * StatsReportPage when the label sticks past the threshold (bug def8e0d5).
     *
     * No .fail() toast — the watchdog handles failure by falling back to a
     * forced status poll and, if still stuck, an escape-hatch toast.
     *
     * @param {string} runId - The stuck run id.
     * @returns {Promise} jQuery promise resolving to { success, ... }.
     */
    forceFinalizeStatsReport(runId) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/local-complete`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ run_id: runId })
        });
    }

    /**
     * Get all results for the most recent stats report run, grouped by category.
     * @param {string} uuid - Session UUID (unused, session from cookie)
     * @returns {Promise} { success, run_id, results: { xp: [...], coins: [...], ... } }
     */
    getStatsReportResults(uuid) {
        // No .fail() toast — same rationale as getStatsReportStatus (polled).
        return $.get(`${this.baseUrl}/stats-report/results`);
    }

    /**
     * Copy a stats report result's gearset to the main gearsets table.
     * @param {string} uuid - Session UUID (unused, session from cookie)
     * @param {string} resultId - The stats report gearset result ID
     * @returns {Promise} { success, gear_set_id, name }
     */
    saveStatsReportGearset(uuid, resultId) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/save-gearset`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ result_id: resultId })
        }).fail((xhr) => this.handleError(xhr, 'Failed to save stats report gearset'));
    }

    /**
     * Save a gear set directly from an export string + display name. Used by
     * the Alternative locations/services rows, which have no stored result row.
     */
    saveGearsetFromExport(exportStr, name) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/save-gearset`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ gearset_export: exportStr, name: name || '' })
        }).fail((xhr) => this.handleError(xhr, 'Failed to save gearset'));
    }

    /**
     * Add new jobs to an existing stats report run (merge mode).
     * @param {string} uuid - Session UUID (unused, session from cookie)
     * @param {string} runId - Existing run ID to merge into
     * @param {string[]} categories - Categories to add
     * @param {string[]} skills - Skills to add
     * @returns {Promise} { success, run_id, new_jobs_added, total_jobs }
     */
    mergeStatsReportJobs(uuid, runId, categories, skills) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/merge`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                run_id: runId,
                categories: categories || [],
                skills: skills || [],
            }),
        }).fail((xhr) => this.handleError(xhr, 'Failed to merge stats report jobs'));
    }

    /**
     * Recalculate a single stats-report row's metric for an arbitrary
     * gearset. Backed by /api/stats-report/recalc-row. Used by the
     * in-place gear-slot picker (2026-05-21).
     *
     * @param {object} args - { activity_name, skill_name, category, chest_name, gearset_slots }
     * @returns {Promise} { success, metric_value, metric_name, metrics_json }
     */
    recalcStatsReportRow(args) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/recalc-row`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(args || {}),
        }).fail((xhr) => this.handleError(xhr, 'Failed to recalculate stats report row'));
    }

    /**
     * Compute non-owned/locked item alternatives for a stats-report
     * row's current gearset, ranked by improvement to the row's
     * metric (XP/step for XP rows, steps-per-reward for chest/coin).
     *
     * @param {object} args - { activity_name, skill_name, category, chest_name, gearset_slots, result_id? }
     *   result_id (optional): goals-report row id — when passed, the server
     *   caches the computed alternatives into that row's metrics_json so a
     *   reload serves them from the DB instead of recomputing.
     * @returns {Promise} { success, alternatives, locked_alternatives }
     */
    getStatsReportSlotAlternatives(args) {
        return $.ajax({
            url: `${this.baseUrl}/stats-report/slot-alternatives`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(args || {}),
        }).fail((xhr) => this.handleError(xhr, 'Failed to compute slot alternatives'));
    }

    // ================================================================
    // PINNED SAVES (Pin Item feature)
    // ================================================================

    /**
     * Get all pinned-save presets for the current session.
     * @returns {Promise} jQuery promise resolving to array of presets.
     */
    getPinnedSaves() {
        return $.get(`${this.baseUrl}/pinned-saves`)
            .fail((xhr) => this.handleError(xhr, 'Failed to load pinned saves'));
    }

    /**
     * Create or update a pinned-save preset. Upserts by name within session.
     * @param {Object} body - { name, pin_paths, id? }
     * @returns {Promise} jQuery promise resolving to the saved preset.
     */
    savePinnedSave(body) {
        return $.ajax({
            url: `${this.baseUrl}/pinned-saves`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(body || {}),
        }).fail((xhr) => this.handleError(xhr, 'Failed to save pinned preset'));
    }

    /**
     * Delete a pinned-save preset by id.
     * @param {string} presetId
     * @returns {Promise} jQuery promise.
     */
    deletePinnedSave(presetId) {
        return $.ajax({
            url: `${this.baseUrl}/pinned-saves/${encodeURIComponent(presetId)}`,
            method: 'DELETE',
        }).fail((xhr) => this.handleError(xhr, 'Failed to delete pinned preset'));
    }

}

// Global API client instance
const api = new ApiClient();

// Export for ES6 modules
export default api;

// Also make available globally for non-module scripts
window.api = api;
