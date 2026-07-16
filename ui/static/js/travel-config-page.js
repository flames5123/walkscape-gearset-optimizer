/**
 * TravelConfigPage - Top-level container for the #travel-config page.
 *
 * Manages the split-panel layout (Config_Panel + Map_Panel), the draggable
 * Divider, and mobile panel collapse/restore. Delegates map rendering to
 * TravelMap (initialized lazily by main.js on first navigation).
 *
 * Requirements: 1.1–1.22
 */

import ConfigPanel, { detectExceptionRoutes, LOCATION_CANONICAL_REGION } from './travel-config-panel.js';
import { deriveGearsetColors } from './travel-route-gearset.js';
import { clampSplit as sharedClampSplit, SPLIT_MIN as SHARED_SPLIT_MIN, SPLIT_MAX as SHARED_SPLIT_MAX } from './utils/split-clamp.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Patterns that indicate a gearset-equippable requirement (case-insensitive). */
const GEARSET_REQ_PATTERNS = [
    /diving gear/i,
    /skis equipped/i,
    /light source/i,
];

function filterGearsetReqs(terrainModifiers) {
    return (terrainModifiers || []).filter(r => GEARSET_REQ_PATTERNS.some(p => p.test(r)));
}

const DEFAULT_SPLITS = {
    travel_split_desktop: 33,
    travel_split_mobile_portrait: 50,
    travel_split_mobile_landscape: 33,
};

// Kept as local constants for any call sites that still reference them,
// but the canonical values live in utils/split-clamp.js (SPLIT_MIN / SPLIT_MAX).
const CLAMP_MIN = SHARED_SPLIT_MIN;
const CLAMP_MAX = SHARED_SPLIT_MAX;

const FACTION_COLORS_MAP = {
    jarvonia: '#bbdefa',
    trellin: '#a0e870',
    erdwise: '#fec08d',
    halfling_rebels: '#b8c375',
    syrenthia: '#c7b6fc',
    wallisia: '#e8a060',
    wrentmark: '#f0d080',
};

// ============================================================================
// TRAVELCONFIGPAGE CLASS
// ============================================================================

export default class TravelConfigPage {
    /**
     * @param {string|HTMLElement} element - Selector or element for #travel-config-page
     */
    constructor(element) {
        this.$element = $(element);
        this.travelMap = null;   // Set by main.js after lazy init
        this.configPanel = null; // ConfigPanel instance

        // Travel config store (loaded from backend)
        this._travelConfig = {};

        // Divider drag state
        this._dragging = false;
        this._dragPointerId = null;
        this._currentSplit = null;
        this._panelCollapsed = false;

        this._render();
        this._attachEvents();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _render() {
        const dividerClass = this._isVerticalSplit() ? 'vertical' : 'horizontal';
        this.$element.html(`
            <div class="travel-config-panel" id="travel-config-panel">
                <div class="travel-config-panel-content" id="travel-config-panel-content">
                </div>
            </div>
            <div class="travel-divider ${dividerClass}" id="travel-divider"></div>
            <div class="travel-map-panel" id="travel-map-panel">
                <div class="travel-panel-toggle-tab" id="travel-panel-toggle-tab"><span class="travel-grip-bars">≡</span> <span class="travel-toggle-label">▼ Travel Config</span> <span class="travel-grip-bars">≡</span></div>
                <div id="travel-map-container" style="width:100%;height:100%;"></div>
            </div>
        `);
    }

    _attachEvents() {
        const divider = document.getElementById('travel-divider');
        if (divider) {
            divider.addEventListener('pointerdown', e => this._onPointerDown(e));
            divider.addEventListener('pointermove', e => this._onPointerMove(e));
            divider.addEventListener('pointerup', e => this._onPointerUp(e));
            divider.addEventListener('pointercancel', e => this._onPointerUp(e));
        }

        // Toggle tab: tap = collapse/expand, drag = resize panel split
        const tab = document.getElementById('travel-panel-toggle-tab');
        if (tab) {
            tab.addEventListener('pointerdown', e => this._onTabPointerDown(e));
            tab.addEventListener('pointermove', e => this._onTabPointerMove(e));
            tab.addEventListener('pointerup', e => this._onTabPointerUp(e));
            tab.addEventListener('pointercancel', e => this._onTabPointerUp(e));
        }
    }

    // -------------------------------------------------------------------------
    // Platform detection
    // -------------------------------------------------------------------------

    getPlatform() {
        const w = window.innerWidth;
        const portrait = window.matchMedia('(orientation: portrait)').matches;
        if (w < 768 && portrait) return 'mobile-portrait';
        if (w < 768) return 'mobile-landscape';
        return 'desktop';
    }

    getSplitKey() {
        const p = this.getPlatform();
        if (p === 'mobile-portrait') return 'travel_split_mobile_portrait';
        if (p === 'mobile-landscape') return 'travel_split_mobile_landscape';
        return 'travel_split_desktop';
    }

    _isVerticalSplit() {
        return this.getPlatform() !== 'mobile-portrait';
    }

    // -------------------------------------------------------------------------
    // Panel split
    // -------------------------------------------------------------------------

    /**
     * Clamp a split percentage to [CLAMP_MIN, CLAMP_MAX].
     *
     * Delegates to the shared `clampSplit` in `utils/split-clamp.js` so both
     * the travel panel and the pinned container use identical bounds.
     *
     * @param {number} pct
     * @returns {number}
     */
    static clampSplit(pct) {
        return sharedClampSplit(pct);
    }

    applyPanelSplit(pct) {
        pct = TravelConfigPage.clampSplit(pct);
        this._currentSplit = pct;

        const panel = document.getElementById('travel-config-panel');
        const divider = document.getElementById('travel-divider');
        if (!panel) return;

        // Set CSS variable for group bar positioning
        document.documentElement.style.setProperty('--travel-config-panel-width', pct + '%');

        if (this._isVerticalSplit()) {
            panel.style.flex = `0 0 ${pct}%`;
            panel.style.height = '';
            if (divider) {
                divider.classList.add('vertical');
                divider.classList.remove('horizontal');
            }
        } else {
            panel.style.flex = `0 0 ${pct}%`;
            panel.style.width = '';
            if (divider) {
                divider.classList.add('horizontal');
                divider.classList.remove('vertical');
            }
        }
    }

    loadSplitFromSession(config) {
        const key = this.getSplitKey();
        const splits = config?.panel_splits || {};
        const pct = splits[key] ?? DEFAULT_SPLITS[key];
        this.applyPanelSplit(pct);
    }

    saveSplitToSession(pct, config) {
        const key = this.getSplitKey();
        if (!config.panel_splits) config.panel_splits = {};
        config.panel_splits[key] = TravelConfigPage.clampSplit(pct);
    }

    // -------------------------------------------------------------------------
    // Divider drag (pointer events)
    // -------------------------------------------------------------------------

    _onPointerDown(e) {
        e.preventDefault();
        this._dragging = true;
        this._dragPointerId = e.pointerId;
        e.target.setPointerCapture(e.pointerId);
        document.getElementById('travel-divider')?.classList.add('dragging');
    }

    _onPointerMove(e) {
        if (!this._dragging || e.pointerId !== this._dragPointerId) return;
        const container = this.$element[0].getBoundingClientRect();
        let pct;
        if (this._isVerticalSplit()) {
            pct = ((e.clientX - container.left) / container.width) * 100;
        } else {
            pct = ((e.clientY - container.top) / container.height) * 100;
        }
        this.applyPanelSplit(pct);
    }

    _onPointerUp(e) {
        if (!this._dragging) return;
        this._dragging = false;
        document.getElementById('travel-divider')?.classList.remove('dragging');
        if (this.travelMap) this.travelMap.invalidateSize();
        // Persist split to travel config store
        if (this._currentSplit != null) {
            this.saveSplitToSession(this._currentSplit, this._travelConfig);
            this._saveTravelConfig();
        }
    }

    // -------------------------------------------------------------------------
    // Toggle tab: tap vs drag detection
    // -------------------------------------------------------------------------

    _onTabPointerDown(e) {
        e.preventDefault();
        this._tabDragState = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            isDragging: false,
        };
        e.target.setPointerCapture(e.pointerId);

        // If panel is collapsed, a drag should first restore it
        if (this._panelCollapsed) {
            this._tabDragState.wasCollapsed = true;
        }
    }

    _onTabPointerMove(e) {
        const s = this._tabDragState;
        if (!s || e.pointerId !== s.pointerId) return;

        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Threshold: 8px of movement to start dragging
        if (!s.isDragging && dist > 8) {
            s.isDragging = true;
            // If panel was collapsed, restore it first so the drag has something to resize
            if (s.wasCollapsed) {
                this._restorePanel();
                s.wasCollapsed = false;
            }
        }

        if (s.isDragging) {
            // Reuse the same resize logic as the divider
            const container = this.$element[0].getBoundingClientRect();
            let pct;
            if (this._isVerticalSplit()) {
                pct = ((e.clientX - container.left) / container.width) * 100;
            } else {
                pct = ((e.clientY - container.top) / container.height) * 100;
            }
            this.applyPanelSplit(pct);
        }
    }

    _onTabPointerUp(e) {
        const s = this._tabDragState;
        if (!s || e.pointerId !== s.pointerId) return;

        if (s.isDragging) {
            // Finished dragging — persist the split
            if (this.travelMap) this.travelMap.invalidateSize();
            if (this._currentSplit != null) {
                this.saveSplitToSession(this._currentSplit, this._travelConfig);
                this._saveTravelConfig();
            }
        } else {
            // It was a tap — toggle collapse/expand
            if (this._panelCollapsed) this._restorePanel();
            else this._collapsePanel();
        }

        this._tabDragState = null;
    }

    // -------------------------------------------------------------------------
    // Mobile collapse / restore
    // -------------------------------------------------------------------------

    _setTabLabel(text) {
        const tab = document.getElementById('travel-panel-toggle-tab');
        if (!tab) return;
        const label = tab.querySelector('.travel-toggle-label');
        if (label) label.textContent = text;
    }

    _collapsePanel() {
        this._panelCollapsed = true;
        const panel = document.getElementById('travel-config-panel');
        const divider = document.getElementById('travel-divider');

        this._persistCollapsedState(true);
        this._setTabLabel('▼ Travel Config');

        if (panel) {
            panel.style.transition = 'flex 0.25s ease';
            panel.style.flex = '0 0 0%';
            panel.style.overflow = 'hidden';
            setTimeout(() => {
                panel.style.display = 'none';
                panel.style.transition = '';
                if (divider) divider.style.display = 'none';
                if (this.travelMap) this.travelMap.invalidateSize({ pan: false });
            }, 260);
        } else {
            if (divider) divider.style.display = 'none';
        }
    }

    _restorePanel() {
        this._panelCollapsed = false;
        const panel = document.getElementById('travel-config-panel');
        const divider = document.getElementById('travel-divider');

        this._persistCollapsedState(false);
        this._setTabLabel('▲ Travel Config');
        if (divider) divider.style.display = '';

        if (panel) {
            const targetPct = this._currentSplit ?? 50;
            panel.style.display = '';
            panel.style.flex = '0 0 0%';
            panel.style.overflow = 'hidden';
            panel.offsetHeight;
            panel.style.transition = 'flex 0.25s ease';
            panel.style.flex = `0 0 ${targetPct}%`;
            setTimeout(() => {
                panel.style.transition = '';
                panel.style.overflow = '';
                if (this.travelMap) this.travelMap.invalidateSize({ pan: false });
            }, 260);
        }
    }

    /**
     * Get the collapsed-state key for the current platform.
     * @returns {string} 'mobile_portrait' | 'mobile_landscape'
     */
    _getCollapsedKey() {
        const p = this.getPlatform();
        if (p === 'mobile-portrait') return 'mobile_portrait';
        return 'mobile_landscape';
    }

    /**
     * Persist the panel collapsed state into the travel config and trigger save.
     * @param {boolean} collapsed
     */
    _persistCollapsedState(collapsed) {
        if (!this._travelConfig.panel_collapsed) {
            this._travelConfig.panel_collapsed = {};
        }
        this._travelConfig.panel_collapsed[this._getCollapsedKey()] = collapsed;
        this._saveTravelConfig();
    }

    /**
     * Restore the panel collapsed state from the travel config on page load.
     * Only applies on mobile platforms where collapse is supported.
     * Req 1.15: Show panel on first visit (default not collapsed).
     */
    _restoreCollapsedState() {
        const platform = this.getPlatform();
        if (platform === 'desktop') return;

        const key = this._getCollapsedKey();
        const collapsed = this._travelConfig.panel_collapsed?.[key];
        if (collapsed === true) {
            this._panelCollapsed = true;
            const panel = document.getElementById('travel-config-panel');
            const divider = document.getElementById('travel-divider');
            if (panel) {
                panel.style.display = 'none';
                panel.style.flex = '0 0 0%';
            }
            if (divider) divider.style.display = 'none';
            this._setTabLabel('▼ Travel Config');
        } else {
            // Panel is expanded — show up arrow
            this._setTabLabel('▲ Travel Config');
        }
    }

    // -------------------------------------------------------------------------
    // Lifecycle hooks (called by main.js routing)
    // -------------------------------------------------------------------------

    onNavigatedTo() {
        console.log('[TravelConfigPage] onNavigatedTo called');
        // Apply default split on first visit
        if (this._currentSplit === null) {
            const key = this.getSplitKey();
            this.applyPanelSplit(DEFAULT_SPLITS[key]);
        }
        if (this.travelMap) this.travelMap.invalidateSize();

        // Initialize ConfigPanel lazily on first visit
        if (!this.configPanel && !this._initConfigPanelRunning) {
            this._initConfigPanel().catch(err => {
                console.error('[TravelConfigPage] _initConfigPanel failed:', err);
            });
        } else {
            // Returning to page — check for completed/in-progress tasks (Req 13.4, 13.5)
            this._restoreOptimizationTasks();
        }
    }

    /**
     * Initialize the ConfigPanel inside the panel content area.
     * Loads travel config from the backend, then creates the panel.
     * Also applies region auto-detection and restores collapsed state.
     */
    async _initConfigPanel() {
        // Guard against concurrent calls (race from hashchange + switchToTab)
        if (this._initConfigPanelRunning) return;
        this._initConfigPanelRunning = true;

        console.log('[TravelConfigPage] _initConfigPanel START');
        const contentEl = document.getElementById('travel-config-panel-content');
        if (!contentEl) { console.error('[TravelConfigPage] content element not found'); this._initConfigPanelRunning = false; return; }

        // Load travel config from backend (Req 8.1, 8.3)
        let regionUnlock = null;
        try {
            console.log('[TravelConfigPage] fetching /api/travel-config...');
            const resp = await fetch('/api/travel-config');
            console.log('[TravelConfigPage] fetch response:', resp.status);
            if (resp.ok) {
                const data = await resp.json();
                this._travelConfig = data.config || {};
                // Migrate long_short → multi (long_short was removed from the UI)
                for (const regionCfg of Object.values(this._travelConfig.regions || {})) {
                    if (regionCfg.mode === 'long_short') {
                        regionCfg.mode = 'multi';
                        regionCfg.multi_count = regionCfg.multi_count || 2;
                    }
                }
                regionUnlock = data.region_unlock || null;
                // Store ring detection flag on config for MovementActivitiesSection
                this._travelConfig._has_ring_of_homesickness = data.has_ring_of_homesickness || false;
                // Store Navigate Desert ability flag for Wrentmark warning (Req 9.5)
                this._travelConfig._has_navigate_desert = data.has_navigate_desert || false;
            }
        } catch (err) {
            console.warn('[TravelConfigPage] Failed to load travel config:', err);
        }

        // Apply region auto-detection (Req 12.1, 12.2, 12.3)
        // Only apply on first load when regions have no user-set enabled state
        if (regionUnlock) {
            this._applyRegionAutoDetection(regionUnlock);
        } else {
            // Fallback: call dedicated region-unlock endpoint
            regionUnlock = await this._fetchRegionUnlock();
            if (regionUnlock) {
                this._applyRegionAutoDetection(regionUnlock);
            }
        }

        console.log('[TravelConfigPage] creating ConfigPanel...');

        // Restore saved panel split from config (overrides the default)
        this.loadSplitFromSession(this._travelConfig);
        if (this.travelMap) this.travelMap.invalidateSize();

        // Restore collapsed state from config (Req 8.1, 8.3)
        this._restoreCollapsedState();

        // Get routes and locations from TravelMap if available
        const routes = this.travelMap?.routes || [];
        const locations = this.travelMap?.locations || [];

        try {
            this.configPanel = new ConfigPanel(contentEl, {
                config: this._travelConfig,
                routes,
                locations,
                onConfigChange: () => this._saveTravelConfig(),
                onRouteColorChange: (routeIds, color) => {
                    if (this.travelMap) {
                        const colorMap = {};
                        for (const id of routeIds) colorMap[id] = color;
                        // If this is a faction color (from clear/reset), clear statuses so diamonds are removed
                        const isFactionColor = Object.values(FACTION_COLORS_MAP).includes(color);
                        if (isFactionColor) {
                            this.travelMap.clearRouteStatuses(colorMap);
                        } else {
                            this.travelMap.setRouteColors(colorMap);
                        }
                    }
                },
                onPanToRoute: (routeId) => {
                    if (this.travelMap) this.travelMap.panToRoute(routeId);
                },
                onOptimize: (taskKey, payload) => {
                    this._startOptimization(taskKey, payload);
                },
                onGenerateAll: () => {
                    this._generateAll();
                },
            });
            console.log('[TravelConfigPage] ConfigPanel created successfully');
        } catch (err) {
            console.error('[TravelConfigPage] ConfigPanel constructor CRASHED:', err);
        }

        // Restore any in-progress or completed optimization tasks (Req 5.11, 5.12)
        this._restoreOptimizationTasks();

        // Check Navigate Desert ability for Wrentmark (Req 9.5)
        this._checkNavigateDesertAbility();

        // Validate all exception route gearsets on page load (Req 9.1)
        this._validateAllExceptionRoutes();

        // Push saved gearset colors to the map on initial load
        this._applyAllSavedColorsToMap();

        // After async validation completes (~1-2s), re-apply with updated per-route statuses
        setTimeout(() => this._applyAllSavedColorsToMap(), 2500);

        // Re-invalidate map after config panel is built and split is applied
        if (this.travelMap) {
            setTimeout(() => this.travelMap.invalidateSize(), 100);
        }

        this._initConfigPanelRunning = false;
    }

    /**
     * Apply region auto-detection results to the travel config.
     *
     * On first load (no existing config), pre-check regions based on unlock
     * status. If the user already has a saved config with explicit region
     * enabled states, those are preserved (manual override).
     *
     * When no character export is available (all_disabled=true), default to
     * only Jarvonia enabled.
     *
     * Requirements: 12.1, 12.2, 12.3
     *
     * @param {Object} regionUnlock - { unlocked: {...}, all_disabled: bool, reasons: {...} }
     */
    _applyRegionAutoDetection(regionUnlock) {
        if (!this._travelConfig.regions) return;

        // Check if this is a "fresh" config (no regions have gearsets assigned)
        // If the user has already configured regions, don't override their choices
        const hasUserConfig = Object.values(this._travelConfig.regions).some(r =>
            r.gearsets && Object.keys(r.gearsets).length > 0
        );

        // Also check if any non-default enabled state exists (user manually toggled)
        const hasManualOverride = this._travelConfig._region_auto_applied === true;

        if (hasUserConfig || hasManualOverride) {
            console.log('[TravelConfigPage] Skipping region auto-detection (user has existing config)');
            return;
        }

        const unlocked = regionUnlock.unlocked || {};
        const allDisabled = regionUnlock.all_disabled || false;

        if (allDisabled) {
            // No character export: only Jarvonia enabled (Req 12.3)
            for (const [regionId, regionCfg] of Object.entries(this._travelConfig.regions)) {
                regionCfg.enabled = regionId === 'jarvonia';
            }
        } else {
            // Apply unlock detection results (Req 12.1)
            for (const [regionId, regionCfg] of Object.entries(this._travelConfig.regions)) {
                if (regionId in unlocked) {
                    regionCfg.enabled = unlocked[regionId];
                }
            }
        }

        // Mark that auto-detection has been applied so we don't re-apply on next load
        this._travelConfig._region_auto_applied = true;
        this._saveTravelConfig();

        console.log('[TravelConfigPage] Region auto-detection applied:', unlocked);
    }

    /**
     * Fetch region unlock status from the dedicated endpoint.
     * Used as a fallback when GET /api/travel-config doesn't include unlock data,
     * or when refreshing after a character re-import.
     *
     * Requirements: 12.1, 12.3
     *
     * @returns {Object|null} Region unlock data or null on failure
     */
    async _fetchRegionUnlock() {
        try {
            const resp = await fetch('/api/travel-config/region-unlock');
            if (resp.ok) {
                const data = await resp.json();
                return data.success ? data : null;
            }
        } catch (err) {
            console.warn('[TravelConfigPage] Failed to fetch region unlock:', err);
        }
        return null;
    }

    /**
     * Refresh region unlock status after a character data change.
     * Calls the dedicated endpoint and re-applies auto-detection,
     * but only if the user hasn't manually overridden regions.
     *
     * This can be called externally (e.g., after character import)
     * to update region enabled states.
     *
     * Requirements: 12.1, 12.2
     */
    async refreshRegionUnlock() {
        const unlock = await this._fetchRegionUnlock();
        if (!unlock) return;

        // Reset the auto-applied flag so detection can re-run
        // (only if user hasn't assigned any gearsets — manual override check
        // is handled inside _applyRegionAutoDetection)
        if (!this._travelConfig._region_auto_applied) {
            this._applyRegionAutoDetection(unlock);
        } else {
            // User has seen auto-detection before. Only update if they
            // haven't assigned any gearsets (preserving manual overrides).
            const hasGearsets = Object.values(this._travelConfig.regions || {}).some(r =>
                r.gearsets && Object.keys(r.gearsets).length > 0
            );
            if (!hasGearsets) {
                delete this._travelConfig._region_auto_applied;
                this._applyRegionAutoDetection(unlock);
                if (this.configPanel) {
                    this.configPanel.setConfig(this._travelConfig);
                }
            }
        }
    }

    /**
     * Check if the character has the Navigate Desert ability (from pets).
     * If Wrentmark routes require it and the character doesn't have it,
     * set a region-level warning on the Wrentmark RegionCard.
     *
     * Req 9.5: When a route requires Navigate Desert and the user's character
     * does not have that ability, display a warning on the Wrentmark RegionCard.
     */
    _checkNavigateDesertAbility() {
        const wrentmarkCfg = this._travelConfig.regions?.wrentmark;
        if (!wrentmarkCfg) return;

        // Check if any Wrentmark routes require Navigate Desert
        const routes = this.travelMap?.routes || [];
        const wrentmarkRoutes = routes.filter(r =>
            r.faction === 'wrentmark' || r.destFaction === 'wrentmark'
        );

        // Check character config for Navigate Desert ability (from pets)
        const hasAbility = this._travelConfig._has_navigate_desert || false;

        // Check if any routes in the region require Navigate Desert
        // This is determined by the backend validation, but we can also
        // check the route data for 'requires' fields
        const needsDesert = wrentmarkRoutes.some(r =>
            r.requires && r.requires[0] === 'ability' &&
            r.requires[1]?.toLowerCase().includes('navigate desert')
        );

        if (needsDesert && !hasAbility) {
            wrentmarkCfg._region_warnings = [
                'Some routes require the Navigate Desert ability. You need a pet with this ability (e.g., Camel, Dromedary, or Bactrian Camel).'
            ];
        } else {
            wrentmarkCfg._region_warnings = [];
        }

        // Refresh the Wrentmark card if it exists
        if (this.configPanel) {
            const cards = this.configPanel.getRegionCards();
            const wrentmarkCard = cards.find(c => c.getRegion().id === 'wrentmark');
            if (wrentmarkCard) {
                wrentmarkCard.setRegionConfig(wrentmarkCfg);
            }
        }
    }

    /**
     * Check for in-progress or completed optimization tasks when returning
     * to the page. Polls the optimize-status endpoint for any active task
     * keys found in the config.
     *
     * Requirements: 5.11, 5.12, 13.4, 13.5
     */
    async _restoreOptimizationTasks() {
        // Collect all task keys that might have pending results
        const taskKeys = [];
        const regions = this._travelConfig.regions || {};
        for (const [regionId, regionCfg] of Object.entries(regions)) {
            if (!regionCfg.enabled) continue;
            const gearsets = regionCfg.gearsets || {};
            for (const [slot, gs] of Object.entries(gearsets)) {
                if (gs._task_status === 'running') {
                    taskKeys.push(`${regionId}:${slot}`);
                }
            }
        }

        // Also check exception routes
        const exceptions = this._travelConfig.exceptions || {};
        for (const [routeId, exCfg] of Object.entries(exceptions)) {
            if (exCfg.gearset?._task_status === 'running') {
                taskKeys.push(`exception:${routeId}`);
            }
        }

        if (taskKeys.length === 0) return;

        console.log('[TravelConfigPage] Restoring optimization tasks:', taskKeys);

        // Show loading state on Generate All button if tasks are running (Req 13.5)
        this._setGenerateAllLoading(true);

        try {
            const resp = await fetch(`/api/travel-config/optimize-status?keys=${encodeURIComponent(taskKeys.join('|'))}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const tasks = data.tasks || {};

            let configChanged = false;
            const stillRunning = [];

            for (const taskKey of taskKeys) {
                const taskInfo = tasks[taskKey];

                if (taskInfo?.status === 'complete') {
                    // Apply completed result to config (Req 13.4)
                    this._applyOptimizationResult(taskKey, taskInfo);
                    this._markTaskRunning(taskKey, false);
                    configChanged = true;
                } else if (taskInfo?.status === 'running') {
                    // Still running — show loading state and start polling (Req 13.5)
                    stillRunning.push(taskKey);
                    this._markTaskRunning(taskKey, true);
                    this._startPollingTask(taskKey);
                } else {
                    // Task not found or errored — clear running state
                    this._markTaskRunning(taskKey, false);
                    configChanged = true;
                }
            }

            if (configChanged) {
                this._saveTravelConfig();
                // Re-render config panel to show updated gearsets
                if (this.configPanel) {
                    this.configPanel.setConfig(this._travelConfig);
                }
            }

            // If no tasks are still running, clear loading state
            if (stillRunning.length === 0) {
                this._setGenerateAllLoading(false);
            }
        } catch (err) {
            console.warn('[TravelConfigPage] Failed to restore optimization tasks:', err);
            this._setGenerateAllLoading(false);
        }
    }

    /**
     * Apply a completed optimization result to the travel config store.
     * @param {string} taskKey - e.g. "jarvonia:single", "exception:route-id"
     * @param {Object} taskInfo - { status, export_string, stats, route_statuses }
     */
    _applyOptimizationResult(taskKey, taskInfo) {
        const [regionOrType, slot] = taskKey.split(':');

        if (regionOrType === 'exception') {
            // Exception route result
            const routeId = taskKey.substring('exception:'.length);
            if (!this._travelConfig.exceptions) this._travelConfig.exceptions = {};
            if (!this._travelConfig.exceptions[routeId]) this._travelConfig.exceptions[routeId] = { gearset: {} };
            const gs = this._travelConfig.exceptions[routeId].gearset || {};
            gs.export_string = taskInfo.export_string;
            gs.stats = taskInfo.stats;
            delete gs._task_status;
            // Build name from route name (check cross-region routes for flipped names)
            let routeName = null;
            // First check if any region card has this as a cross-region exception with a flipped name
            const cards = this.configPanel?.getRegionCards() || [];
            for (const card of cards) {
                const exRoute = (card.exceptionRoutes || []).find(ex => ex.id === routeId);
                if (exRoute) {
                    routeName = exRoute.name; // Already flipped if needed (e.g., "Granfiddich Shores → Kelp Forest")
                    break;
                }
            }
            // Fall back to routes.json name
            if (!routeName) {
                const route = (this.travelMap?.routes || []).find(r => r.id === routeId);
                if (route) routeName = route.name;
            }
            if (routeName) {
                const now = new Date();
                const pad = n => String(n).padStart(2, '0');
                const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                gs.name = `${routeName} ${dateStr}`;
            }
            this._travelConfig.exceptions[routeId].gearset = gs;
        } else {
            // Region gearset result
            const regionCfg = this._travelConfig.regions?.[regionOrType];
            if (!regionCfg) return;
            if (!regionCfg.gearsets) regionCfg.gearsets = {};

            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            const regionName = regionOrType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

            // Multi mode: unpack gearsets array into numbered slots
            if (taskInfo.gearsets && Array.isArray(taskInfo.gearsets)) {
                // Derive distinct colors for each gearset
                const factionColor = FACTION_COLORS_MAP[regionOrType] || '#888';
                const colors = deriveGearsetColors(factionColor, taskInfo.gearsets.length);

                for (let gi = 0; gi < taskInfo.gearsets.length; gi++) {
                    const gs = taskInfo.gearsets[gi];
                    const gsSlot = gs.slot || String(gi + 1);
                    if (!regionCfg.gearsets[gsSlot]) regionCfg.gearsets[gsSlot] = {};
                    regionCfg.gearsets[gsSlot].export_string = gs.gearset_export;
                    regionCfg.gearsets[gsSlot].stats = gs.stats;
                    // Build name from route names if available
                    const gsRouteIds = gs.route_ids || [];
                    const gsRouteNames = gsRouteIds.map(rid => {
                        const route = (this.travelMap?.routes || []).find(r => r.id === rid);
                        return route ? route.name : null;
                    }).filter(Boolean);
                    let gsName;
                    if (gsRouteNames.length === 1) {
                        gsName = `${regionName} ${gsRouteNames[0]}`;
                    } else if (gsRouteNames.length > 1) {
                        gsName = `${regionName} ${gsRouteNames[0]} +${gsRouteNames.length - 1}`;
                    } else {
                        gsName = `${regionName} ${gsSlot}`;
                    }
                    regionCfg.gearsets[gsSlot].name = `${gsName} - ${dateStr}`;
                    regionCfg.gearsets[gsSlot].saved_gearset_id = null;
                    regionCfg.gearsets[gsSlot]._validation_warnings = [];
                    regionCfg.gearsets[gsSlot].route_ids = gs.route_ids || [];
                    // Assign distinct color (only if user hasn't set a custom one)
                    if (!regionCfg.gearsets[gsSlot].color) {
                        regionCfg.gearsets[gsSlot].color = colors[gi] || factionColor;
                    }
                    delete regionCfg.gearsets[gsSlot]._task_status;
                }
                // Clean up the "multi" slot key if it exists
                delete regionCfg.gearsets['multi'];
                // Clean up old numbered slots beyond the new count
                const newCount = taskInfo.gearsets.length;
                for (const key of Object.keys(regionCfg.gearsets)) {
                    const num = parseInt(key, 10);
                    if (!isNaN(num) && num > newCount) {
                        delete regionCfg.gearsets[key];
                    }
                }
                // Store breakpoint
                if (taskInfo.breakpoint != null) {
                    regionCfg.breakpoint = taskInfo.breakpoint;
                }
                // If deduplication reduced the count, update multi_count and store a note
                const actualCount = taskInfo.actual_count ?? taskInfo.gearsets.length;
                const requestedCount = regionCfg.multi_count || 2;
                if (actualCount < requestedCount) {
                    regionCfg.multi_count = actualCount;
                    regionCfg._multi_max_note = `Optimizer found ${actualCount} distinct gearsets (requested ${requestedCount})`;
                } else {
                    delete regionCfg._multi_max_note;
                }
            } else {
                // Single/advanced/requirements mode: one result into one slot
                if (!regionCfg.gearsets[slot]) regionCfg.gearsets[slot] = {};
                regionCfg.gearsets[slot].export_string = taskInfo.export_string;
                regionCfg.gearsets[slot].stats = taskInfo.stats;
                // Build a readable slot label
                let slotLabel = '';
                if (slot === 'single') {
                    slotLabel = '';
                } else if (slot.startsWith('req_')) {
                    // Use the short requirement label stored when optimization was triggered
                    const reqLabel = regionCfg.gearsets[slot]?._req_label;
                    if (reqLabel) {
                        slotLabel = ` ${reqLabel}`;
                    } else {
                        const idx = parseInt(slot.replace('req_', ''), 10);
                        slotLabel = idx === 0 ? ' No Req' : ` Req ${idx}`;
                    }
                } else {
                    // For advanced mode, build name from route names if available
                    const routeNames = regionCfg.gearsets[slot]?.route_names || [];
                    if (routeNames.length > 0) {
                        if (routeNames.length === 1) {
                            slotLabel = ` ${routeNames[0]}`;
                        } else if (routeNames.length <= 2) {
                            slotLabel = ` ${routeNames.join(' & ')}`;
                        } else {
                            slotLabel = ` ${routeNames[0]} +${routeNames.length - 1}`;
                        }
                    } else {
                        slotLabel = ` ${slot}`;
                    }
                }
                regionCfg.gearsets[slot].name = `${regionName}${slotLabel} - ${dateStr}`;
                regionCfg.gearsets[slot].saved_gearset_id = null;
                regionCfg.gearsets[slot]._validation_warnings = [];
                delete regionCfg.gearsets[slot]._task_status;

                if (taskInfo.route_statuses) {
                    regionCfg.gearsets[slot].route_ids = Object.keys(taskInfo.route_statuses);
                }

                // Derive distinct colors for requirements mode (like multi mode)
                if (slot.startsWith('req_') && !regionCfg.gearsets[slot].color) {
                    const reqKeys = Object.keys(regionCfg.gearsets)
                        .filter(k => k.startsWith('req_'))
                        .sort((a, b) => parseInt(a.replace('req_', ''), 10) - parseInt(b.replace('req_', ''), 10));
                    const factionColor = FACTION_COLORS_MAP[regionOrType] || '#888';
                    const colors = deriveGearsetColors(factionColor, reqKeys.length);
                    const idx = reqKeys.indexOf(slot);
                    if (idx >= 0 && colors[idx]) {
                        regionCfg.gearsets[slot].color = colors[idx];
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Optimization — Generate All & per-slot optimization
    // Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 4.11
    // -------------------------------------------------------------------------

    /**
     * Start a single optimization task for one gearset slot.
     * POSTs to /api/travel-config/optimize, then starts polling.
     *
     * @param {string} taskKey - e.g. "jarvonia:single", "trellin:1"
     * @param {Object} payload - Request body for the optimize endpoint
     */
    async _startOptimization(taskKey, payload) {
        console.log('[TravelConfigPage] Starting optimization:', taskKey);

        // Add locked slots data to payload from per-slot locks + global toggle.
        // Bug 0ca4acab: previously only the global "Lock current gear" toggle
        // was honored, ignoring per-slot locks set via the lock icon.
        const lockedSlots = {};
        const currentGear = store.state.gearsets?.current || {};
        const perSlotLocks = store.state.gearsets?.lockedSlots || {};

        // Per-slot locks (lock icon clicked individually per slot)
        for (const slotName of Object.keys(perSlotLocks)) {
            const lockValue = perSlotLocks[slotName];
            if (lockValue && typeof lockValue === 'object' && lockValue.itemId) {
                const lockData = {
                    itemId: lockValue.itemId,
                    quality: lockValue.quality || null,
                };
                if (lockValue.level !== undefined) lockData.level = lockValue.level;
                lockedSlots[slotName] = lockData;
            } else if (lockValue) {
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

        // Global "Lock current gear" toggle — lock everything else equipped
        if (window.settingsModal?.lockCurrentGearSlots) {
            for (const [slot, item] of Object.entries(currentGear)) {
                if (!item || !item.itemId) continue;
                if (lockedSlots[slot]) continue;
                lockedSlots[slot] = {
                    itemId: item.itemId,
                    quality: item.quality || null,
                };
            }
        }

        if (Object.keys(lockedSlots).length > 0) {
            payload.locked_slots = lockedSlots;
            console.log('[TravelConfigPage] Locked slots:', lockedSlots);
        }

        // Mark the gearset slot as running in config (clears old data)
        this._markTaskRunning(taskKey, true);

        // Re-render the card AFTER marking (so new DOM exists), then re-apply spinners
        const [regionOrType, slot] = taskKey.split(/:(.*)/);
        if (regionOrType !== 'exception' && this.configPanel) {
            const cards = this.configPanel.getRegionCards();
            const card = cards.find(c => c.getRegion().id === regionOrType);
            if (card) {
                card.setRegionConfig(this._travelConfig.regions?.[regionOrType] || {});
                card._render();
                // Re-apply spinners on the fresh DOM
                card.setSlotOptimizing(slot);
            }
        }

        try {
            const resp = await fetch('/api/travel-config/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (resp.status === 429) {
                if (window.api) window.api.showInfo('Optimization is already running for this gearset.');
                // Still start polling in case it was started previously
                this._startPollingTask(taskKey);
                return;
            }

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                const msg = errData.detail || errData.message || `Server error ${resp.status}`;
                this._markTaskRunning(taskKey, false);
                this._handleTaskError(taskKey, msg);
                return;
            }

            const data = await resp.json();
            if (data.success) {
                this._startPollingTask(taskKey);
                this._saveTravelConfig();
            }
        } catch (err) {
            console.error('[TravelConfigPage] Optimize request failed:', err);
            this._markTaskRunning(taskKey, false);
            if (window.api) window.api.showError(err.message || 'Optimization failed to start.');
        }
    }

    /**
     * Generate All: start one optimization task per enabled non-Skip region.
     * Each task uses the region's currently selected Gearset_Mode.
     *
     * Requirements: 13.1, 13.2, 13.3
     */
    async _generateAll() {
        const regions = this._travelConfig.regions || {};
        const cards = this.configPanel?.getRegionCards() || [];

        // Collect tasks to start
        const tasksToStart = [];

        for (const card of cards) {
            const regionId = card.getRegion().id;
            const regionCfg = regions[regionId];
            if (!regionCfg?.enabled) continue;

            const mode = regionCfg.mode || 'single';
            if (mode === 'skip') continue;

            const routes = card.routes || [];
            if (!routes.length) continue;

            // Determine which slots need optimization based on mode
            const slots = this._getSlotsForMode(regionId, mode, regionCfg, routes);
            for (const slot of slots) {
                tasksToStart.push(slot);
            }
        }

        // Also optimize cross-region routes that don't have gearsets yet
        const exceptionsConfig = this._travelConfig.exceptions || {};
        const allRoutes = this.travelMap?.routes || [];
        const exceptionRoutes = detectExceptionRoutes(allRoutes);
        for (const exRoute of exceptionRoutes) {
            // Only include if the starting region is enabled
            const regionCfg = this._travelConfig.regions?.[exRoute.fromRegion];
            if (!regionCfg?.enabled) continue;
            const routeId = exRoute.id;
            const exCfg = exceptionsConfig[routeId];
            if (exCfg?.gearset?.export_string) continue; // Already has a gearset
            const taskKey = `exception:${routeId}`;
            tasksToStart.push({
                taskKey,
                payload: {
                    task_key: taskKey,
                    region_id: 'exception',
                    gearset_slot: routeId,
                    mode: 'single',
                    route_ids: [routeId],
                },
            });
        }

        if (tasksToStart.length === 0) {
            if (window.api) window.api.showInfo('No enabled regions to optimize.');
            return;
        }

        console.log(`[TravelConfigPage] Generate All: starting ${tasksToStart.length} tasks`);

        // Set loading state on Generate All button
        this._setGenerateAllLoading(true);

        // Start all tasks
        for (const task of tasksToStart) {
            await this._startOptimization(task.taskKey, task.payload);
        }
    }

    /**
     * Get the optimization task slots for a region based on its mode.
     * For single mode: one task for the whole region.
     * For long_short/multi: one task for the whole region (backend handles splitting).
     * For advanced: one task per empty slot.
     * For requirements: one task per requirement group.
     *
     * @param {string} regionId
     * @param {string} mode
     * @param {Object} regionCfg
     * @param {Object[]} routes
     * @returns {Array<{taskKey: string, payload: Object}>}
     */
    _getSlotsForMode(regionId, mode, regionCfg, routes) {
        const allRouteIds = routes.map(r => r.id);
        const gearsets = regionCfg.gearsets || {};

        if (mode === 'single') {
            const taskKey = `${regionId}:single`;
            return [{
                taskKey,
                payload: {
                    task_key: taskKey,
                    region_id: regionId,
                    gearset_slot: 'single',
                    mode: 'single',
                    route_ids: allRouteIds,
                },
            }];
        }

        if (mode === 'long_short' || mode === 'multi') {
            // Multi mode: one task for the whole region
            const count = regionCfg.multi_count || 2;
            const taskKey = `${regionId}:multi`;
            return [{
                taskKey,
                payload: {
                    task_key: taskKey,
                    region_id: regionId,
                    gearset_slot: 'multi',
                    mode: mode,
                    multi_count: count,
                    route_ids: allRouteIds,
                },
            }];
        }

        if (mode === 'advanced') {
            // One task per route that doesn't have a gearset yet
            const tasks = [];
            for (let i = 0; i < routes.length; i++) {
                const slotKey = String(i + 1);
                const gs = gearsets[slotKey];
                if (gs?.export_string) continue; // Already has a gearset
                // Check for grouped slots
                const groupKey = Object.keys(gearsets).find(k =>
                    k.includes(',') && k.split(',').includes(slotKey)
                );
                if (groupKey && gearsets[groupKey]?.export_string) continue;

                const routeIds = groupKey
                    ? groupKey.split(',').map(k => routes[parseInt(k, 10) - 1]?.id).filter(Boolean)
                    : [routes[i].id];
                const actualSlot = groupKey || slotKey;
                const taskKey = `${regionId}:${actualSlot}`;
                tasks.push({
                    taskKey,
                    payload: {
                        task_key: taskKey,
                        region_id: regionId,
                        gearset_slot: actualSlot,
                        mode: 'advanced',
                        route_ids: routeIds,
                    },
                });
            }
            return tasks;
        }

        if (mode === 'requirements') {
            // One task per requirement group
            const tasks = [];
            const reqGroups = {};
            for (let i = 0; i < routes.length; i++) {
                const reqs = filterGearsetReqs(routes[i].terrainModifiers).slice().sort();
                const key = reqs.length ? reqs.join(' | ') : '__none__';
                if (!reqGroups[key]) reqGroups[key] = { slotKeys: [], routeIds: [] };
                reqGroups[key].slotKeys.push(String(i + 1));
                reqGroups[key].routeIds.push(routes[i].id);
            }
            let groupIdx = 0;
            for (const [, group] of Object.entries(reqGroups)) {
                const slotKey = `req_${groupIdx}`;
                const gs = gearsets[slotKey];
                if (gs?.export_string) { groupIdx++; continue; }
                const taskKey = `${regionId}:${slotKey}`;
                tasks.push({
                    taskKey,
                    payload: {
                        task_key: taskKey,
                        region_id: regionId,
                        gearset_slot: slotKey,
                        mode: 'requirements',
                        route_ids: group.routeIds,
                    },
                });
                groupIdx++;
            }
            return tasks;
        }

        return [];
    }

    // -------------------------------------------------------------------------
    // Task polling
    // -------------------------------------------------------------------------

    /**
     * Start polling for a specific task key.
     * Polls /api/travel-config/optimize-status every 2 seconds.
     * @param {string} taskKey
     */
    _startPollingTask(taskKey) {
        if (!this._pollingTasks) this._pollingTasks = {};
        // Don't start duplicate polling
        if (this._pollingTasks[taskKey]) return;

        const intervalId = setInterval(() => this._pollTask(taskKey), 2000);
        this._pollingTasks[taskKey] = intervalId;

        // Also poll once immediately
        this._pollTask(taskKey);
    }

    /**
     * Stop polling for a specific task key.
     * @param {string} taskKey
     */
    _stopPollingTask(taskKey) {
        if (!this._pollingTasks) return;
        const intervalId = this._pollingTasks[taskKey];
        if (intervalId) {
            clearInterval(intervalId);
            delete this._pollingTasks[taskKey];
        }
        // Check if all tasks are done → update Generate All button
        this._checkAllTasksDone();
    }

    /**
     * Poll the optimize-status endpoint for a single task.
     * @param {string} taskKey
     */
    async _pollTask(taskKey) {
        try {
            const resp = await fetch(
                `/api/travel-config/optimize-status?keys=${encodeURIComponent(taskKey)}`
            );
            if (!resp.ok) return;

            const data = await resp.json();
            if (!data.success || !data.tasks) return;

            const taskResult = data.tasks[taskKey];
            if (!taskResult) {
                // Task not found on server — stop polling
                this._stopPollingTask(taskKey);
                this._markTaskRunning(taskKey, false);
                return;
            }

            if (taskResult.status === 'complete') {
                this._stopPollingTask(taskKey);
                this._applyOptimizationResult(taskKey, taskResult);
                this._markTaskRunning(taskKey, false);
                this._saveTravelConfig(true);  // Immediate save to persist colors before any reload
                // Re-render the affected region card
                this._refreshRegionCard(taskKey);
                // Update map colors (slight delay to let card render settle)
                setTimeout(() => this._updateMapForTask(taskKey, taskResult), 50);
            } else if (taskResult.status === 'error') {
                this._stopPollingTask(taskKey);
                this._markTaskRunning(taskKey, false);
                this._handleTaskError(taskKey, taskResult.error || 'Optimization failed.');
                this._saveTravelConfig();
                this._refreshRegionCard(taskKey);
            }
            // status === 'running' → keep polling
        } catch (err) {
            console.warn('[TravelConfigPage] Poll error for', taskKey, err);
        }
    }

    /**
     * Mark a task as running or not in the config store.
     * Used for page-return restoration (Req 13.4, 13.5).
     * @param {string} taskKey
     * @param {boolean} running
     */
    _markTaskRunning(taskKey, running) {
        const [regionOrType, slot] = taskKey.split(/:(.*)/);

        if (regionOrType === 'exception') {
            const routeId = slot;
            if (!this._travelConfig.exceptions) this._travelConfig.exceptions = {};
            if (!this._travelConfig.exceptions[routeId]) this._travelConfig.exceptions[routeId] = { gearset: {} };
            if (!this._travelConfig.exceptions[routeId].gearset) this._travelConfig.exceptions[routeId].gearset = {};
            if (running) {
                this._travelConfig.exceptions[routeId].gearset._task_status = 'running';
            } else {
                delete this._travelConfig.exceptions[routeId].gearset._task_status;
            }
        } else {
            const regionCfg = this._travelConfig.regions?.[regionOrType];
            if (!regionCfg) return;
            if (!regionCfg.gearsets) regionCfg.gearsets = {};
            if (!regionCfg.gearsets[slot]) regionCfg.gearsets[slot] = {};
            if (running) {
                regionCfg.gearsets[slot]._task_status = 'running';
                // Clear old gearset data when starting a new optimization
                regionCfg.gearsets[slot].name = null;
                regionCfg.gearsets[slot].saved_gearset_id = null;
                regionCfg.gearsets[slot].export_string = null;
                regionCfg.gearsets[slot].stats = null;
                regionCfg.gearsets[slot]._validation_warnings = [];

                // For multi mode, also clear the numbered slots ("1", "2", etc.)
                // since those are what actually render, not the "multi" key
                if (slot === 'multi') {
                    const count = regionCfg.multi_count || 2;
                    for (let i = 1; i <= count; i++) {
                        const k = String(i);
                        if (!regionCfg.gearsets[k]) regionCfg.gearsets[k] = {};
                        regionCfg.gearsets[k].name = null;
                        regionCfg.gearsets[k].saved_gearset_id = null;
                        regionCfg.gearsets[k].export_string = null;
                        regionCfg.gearsets[k].stats = null;
                        regionCfg.gearsets[k].route_ids = null;
                        regionCfg.gearsets[k]._validation_warnings = [];
                    }
                }
            } else {
                delete regionCfg.gearsets[slot]._task_status;
            }

            // Update the region card's loading state (spinner + lock)
            if (this.configPanel) {
                const cards = this.configPanel.getRegionCards();
                const card = cards.find(c => c.getRegion().id === regionOrType);
                if (card) {
                    if (running) card.setSlotOptimizing(slot);
                    else card.clearSlotOptimizing(slot);
                }
            }
        }
    }

    /**
     * Handle a task error by showing a toast notification.
     * @param {string} taskKey
     * @param {string} errorMsg
     */
    _handleTaskError(taskKey, errorMsg) {
        console.error(`[TravelConfigPage] Task ${taskKey} failed:`, errorMsg);
        if (window.api) window.api.showError(`Optimization failed: ${errorMsg}`);
    }

    /**
     * Scroll the config panel to the region/gearset that owns a given route.
     * Called when the user clicks a route on the map.
     * @param {routeId} routeId - The route ID clicked
     * @param {string} faction - The route's faction
     */
    scrollToRoute(routeId, faction) {
        if (!this.configPanel) return;

        // Find which region owns this route
        const cards = this.configPanel.getRegionCards();
        for (const card of cards) {
            const routes = card.routes || [];
            const match = routes.find(r => r.id === routeId);
            if (!match) continue;

            // Expand the region card if collapsed
            if (card._collapsed) {
                card._collapsed = false;
                card._render();
            }

            // Scroll the region card into view
            if (card.el) {
                card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }
    }

    /**
     * Refresh the region card affected by a task key.
     * @param {string} taskKey
     */
    _refreshRegionCard(taskKey) {
        const [regionOrType] = taskKey.split(':');
        if (!this.configPanel) return;

        if (regionOrType === 'exception') {
            // Cross-region route — validate and update in-place without full re-render
            const routeId = taskKey.substring('exception:'.length);
            this._validateExceptionRoute(routeId);

            // Find which region card contains this cross-region route and refresh just that card
            const cards = this.configPanel.getRegionCards();
            for (const card of cards) {
                const exRoutes = card.exceptionRoutes || [];
                if (exRoutes.some(ex => ex.id === routeId)) {
                    card.setExceptionsConfig(this._travelConfig.exceptions || {});
                    card.refresh();
                    return;
                }
            }
            return;
        }

        const cards = this.configPanel.getRegionCards();
        const card = cards.find(c => c.getRegion().id === regionOrType);
        if (card) {
            // setRegionConfig updates the reference and re-renders + validates
            card.setRegionConfig(this._travelConfig.regions?.[regionOrType] || {});
        }
    }

    /**
     * Validate an exception route gearset against terrain requirements.
     * Updates the exception config with validation warnings and map colors.
     * Req 9.1, 9.6
     * @param {string} routeId
     */
    async _validateExceptionRoute(routeId) {
        const exCfg = this._travelConfig.exceptions?.[routeId];
        const gs = exCfg?.gearset;
        if (!gs?.export_string) return;

        try {
            const resp = await fetch('/api/travel-config/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    export_string: gs.export_string,
                    route_ids: [routeId],
                }),
            });
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data.success) return;

            const result = data.results?.[routeId];
            if (!result) return;

            const allMet = result.met;
            gs._validation_warnings = result.missing || [];
            if (!gs.stats) gs.stats = {};
            gs.stats.requirements_met = allMet;

            // Apply travel stats from validate response
            if (data.stats) {
                gs.stats.we = data.stats.we ?? gs.stats.we;
                gs.stats.da = data.stats.da ?? gs.stats.da;
                gs.stats.steps_add = data.stats.steps_add ?? gs.stats.steps_add;
                gs.stats.steps_percent = data.stats.steps_percent ?? gs.stats.steps_percent;
            }

            // Update map color for this exception route (Req 9.6)
            if (this.travelMap) {
                // Use gearset color if set, otherwise destination region color
                let defaultColor = '#888';
                if (this.configPanel) {
                    for (const card of this.configPanel.getRegionCards()) {
                        const exRoute = (card.exceptionRoutes || []).find(ex => ex.id === routeId);
                        if (exRoute) {
                            defaultColor = FACTION_COLORS_MAP[exRoute.toRegion] || '#888';
                            break;
                        }
                    }
                }
                const color = allMet ? (gs.color || defaultColor) : '#e05050';
                this.travelMap.setRouteColors({ [routeId]: color });
            }

            // Update the exception route's DOM in-place without full re-render
            if (this.configPanel?.el) {
                const entry = this.configPanel.el.querySelector(
                    `.travel-exception-route-entry[data-route-id="${routeId}"]`
                );
                if (entry) {
                    // Update requirements indicator
                    const reqsSpan = entry.querySelector('.travel-reqs-met, .travel-reqs-unmet');
                    if (reqsSpan) {
                        reqsSpan.className = `travel-gearset-stat ${allMet ? 'travel-reqs-met' : 'travel-reqs-unmet'}`;
                        reqsSpan.textContent = allMet ? '✓ Reqs' : '⚠ Reqs';
                    }

                    // Update or insert warnings
                    const gearsetEl = entry.querySelector('.travel-exception-gearset');
                    if (gearsetEl) {
                        const existing = gearsetEl.querySelector('.travel-gearset-warnings');
                        const warnings = gs._validation_warnings || [];
                        if (warnings.length) {
                            const getIcon = (w) => {
                                const wl = w.toLowerCase();
                                if (wl.includes('ski')) return '🎿';
                                if (wl.includes('diving')) return '🤿';
                                if (wl.includes('light')) return '🔦';
                                if (wl.includes('desert') || wl.includes('navigate')) return '🏜️';
                                return '⚠';
                            };
                            const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const items = warnings.map(w =>
                                `<div class="travel-gearset-warning-item">${getIcon(w)} ${escHtml(w)}</div>`
                            ).join('');
                            const html = `<div class="travel-gearset-warnings">${items}</div>`;
                            if (existing) {
                                existing.outerHTML = html;
                            } else {
                                const statsRow = gearsetEl.querySelector('.travel-gearset-stats');
                                if (statsRow) statsRow.insertAdjacentHTML('afterend', html);
                            }
                        } else if (existing) {
                            existing.remove();
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[TravelConfigPage] Exception route validation error:', err);
        }
    }

    /**
     * Validate all exception routes that have assigned gearsets on page load.
     * Req 9.1: Evaluate terrain requirements immediately after gearset is assigned.
     */
    _validateAllExceptionRoutes() {
        const exceptions = this._travelConfig.exceptions || {};
        for (const [routeId, exCfg] of Object.entries(exceptions)) {
            if (exCfg.gearset?.export_string) {
                this._validateExceptionRoute(routeId);
            }
        }
    }

    /**
     * Update map route colors after a task completes.
     * @param {string} taskKey
     * @param {Object} taskResult
     */
    _updateMapForTask(taskKey, taskResult) {
        if (!this.travelMap) return;

        const [regionOrType] = taskKey.split(':');

        if (regionOrType === 'exception') {
            // Exception route — update map color based on requirements_met
            const routeId = taskKey.substring('exception:'.length);
            const exCfg = this._travelConfig.exceptions?.[routeId];
            const gs = exCfg?.gearset;
            if (gs) {
                const reqsMet = gs.stats?.requirements_met !== false;
                // Find the exception route's destination region for default color
                let defaultColor = '#888';
                if (this.configPanel) {
                    for (const card of this.configPanel.getRegionCards()) {
                        const exRoute = (card.exceptionRoutes || []).find(ex => ex.id === routeId);
                        if (exRoute) {
                            defaultColor = FACTION_COLORS_MAP[exRoute.toRegion] || '#888';
                            break;
                        }
                    }
                }
                const color = reqsMet ? (gs.color || defaultColor) : '#e05050';
                this.travelMap.setRouteColors({ [routeId]: color });
            }
            return;
        }

        const regionCfg = this._travelConfig.regions?.[regionOrType];
        if (!regionCfg) return;

        const gearsets = regionCfg.gearsets || {};
        const statusMap = {};
        for (const [slotKey, gs] of Object.entries(gearsets)) {
            if (slotKey.startsWith('_')) continue;
            if (!gs.route_ids || !gs.export_string) {
                if (gs.export_string && !gs.route_ids) {
                    console.warn(`[_updateMapForTask] Slot ${slotKey} has export but NO route_ids`);
                }
                continue;
            }
            const color = gs.color || FACTION_COLORS_MAP[regionOrType] || '#888';
            console.log(`[_updateMapForTask] Slot ${slotKey}: color=${color}, routes=${gs.route_ids.length}, reqs_met=${gs.stats?.requirements_met}`);
            const reqsMet = gs.stats?.requirements_met !== false;
            for (const rid of gs.route_ids) {
                statusMap[rid] = {
                    status: reqsMet ? 'assigned_met' : 'assigned_unmet',
                    color: color,
                    steps: null,
                };
            }
        }
        if (Object.keys(statusMap).length > 0) {
            console.log(`[_updateMapForTask] Pushing ${Object.keys(statusMap).length} routes to map for ${regionOrType}`);
            this.travelMap.updateRouteStatuses(statusMap);
        } else {
            console.warn(`[_updateMapForTask] NO routes to update for ${regionOrType} — gearset keys: ${Object.keys(gearsets).join(', ')}`);
            for (const [k, gs] of Object.entries(gearsets)) {
                console.warn(`  slot ${k}: export=${!!gs.export_string}, route_ids=${gs.route_ids?.length || 0}, color=${gs.color}`);
            }
        }
    }

    /**
     * Apply all saved gearset colors to the map on initial page load.
     * Iterates all regions and their gearset slots, pushing colors for assigned routes.
     */
    _applyAllSavedColorsToMap() {
        if (!this.travelMap) return;
        const regions = this._travelConfig.regions || {};
        const statusMap = {};

        for (const [regionId, regionCfg] of Object.entries(regions)) {
            if (!regionCfg.enabled) continue;
            const gearsets = regionCfg.gearsets || {};
            for (const [slotKey, gs] of Object.entries(gearsets)) {
                if (slotKey.startsWith('_')) continue; // Skip internal keys
                if (!gs.export_string || !gs.route_ids) continue;
                const color = gs.color || FACTION_COLORS_MAP[regionId] || '#888';
                // Use per-route validation statuses if available, otherwise fall back to overall
                const perRoute = gs._route_statuses || {};

                for (const rid of gs.route_ids) {
                    let routeStatus;
                    if (perRoute[rid]) {
                        // Per-route status from validation
                        routeStatus = perRoute[rid];
                    } else {
                        // Fallback: use overall requirements_met
                        const hasWarnings = gs._validation_warnings && gs._validation_warnings.length > 0;
                        const overallUnmet = gs.stats?.requirements_met === false;
                        routeStatus = (hasWarnings || overallUnmet) ? 'assigned_unmet' : 'assigned_met';
                    }
                    statusMap[rid] = {
                        status: routeStatus,
                        color: color,
                        steps: null,
                    };
                }
            }
        }

        console.log(`[TravelConfigPage] _applyAllSavedColorsToMap: ${Object.keys(statusMap).length} routes`);
        // Log per-region details for debugging
        for (const [regionId, regionCfg] of Object.entries(regions)) {
            if (!regionCfg.enabled) continue;
            const gs = regionCfg.gearsets || {};
            const slotKeys = Object.keys(gs).filter(k => !k.startsWith('_'));
            const withRoutes = slotKeys.filter(k => gs[k].route_ids?.length > 0);
            const withExport = slotKeys.filter(k => gs[k].export_string);
            if (slotKeys.length > 0) {
                console.log(`  ${regionId}: ${slotKeys.length} slots, ${withExport.length} with export, ${withRoutes.length} with route_ids`);
            }
        }

        // Exception routes
        const exceptions = this._travelConfig.exceptions || {};
        for (const [routeId, exCfg] of Object.entries(exceptions)) {
            const gs = exCfg.gearset;
            if (!gs?.export_string) continue;
            const color = gs.color || '#c7b6fc';
            const hasWarnings = gs._validation_warnings && gs._validation_warnings.length > 0;
            const overallUnmet = gs.stats?.requirements_met === false;
            statusMap[routeId] = {
                status: (hasWarnings || overallUnmet) ? 'assigned_unmet' : 'assigned_met',
                color: color,
                steps: null,
            };
        }

        if (Object.keys(statusMap).length > 0) {
            console.log(`[TravelConfigPage] _applyAllSavedColorsToMap: pushing ${Object.keys(statusMap).length} routes to map`);
            this.travelMap.updateRouteStatuses(statusMap);
        }

        // Push default region colors for all routes that don't have gearsets assigned.
        // This ensures GDTE sub-regions (erdwise, halfling_rebels) get their correct
        // colors instead of the map's default gdte green.
        // For cross-region routes, use the destination region's color instead.
        if (this.configPanel) {
            const defaultColorMap = {};
            for (const card of this.configPanel.getRegionCards()) {
                if (!card.isEnabled()) continue;
                const regionColor = card.getRegion().color || '#888';
                const regionId = card.getRegion().id;
                for (const route of card.routes) {
                    if (statusMap[route.id]) continue;
                    if (route._isReverse) continue; // Reverse routes handled below

                    // Check if this is a cross-region route by looking up both locations
                    const parts = (route.name || '').split(' to ');
                    if (parts.length === 2) {
                        const fromLoc = parts[0].trim();
                        const toLoc = parts[1].trim();
                        const fromRegion = LOCATION_CANONICAL_REGION[fromLoc];
                        const toRegion = LOCATION_CANONICAL_REGION[toLoc];
                        if (fromRegion && toRegion && fromRegion !== toRegion) {
                            // GDTE internal crossings use origin color (bidirectional)
                            const gdteRegions = new Set(['trellin', 'erdwise', 'halfling_rebels']);
                            if (gdteRegions.has(fromRegion) && gdteRegions.has(toRegion)) {
                                defaultColorMap[route.id] = FACTION_COLORS_MAP[fromRegion] || regionColor;
                                continue;
                            }
                            // Major cross-region: use destination region color
                            const destColor = FACTION_COLORS_MAP[toRegion] || regionColor;
                            defaultColorMap[route.id] = destColor;
                            continue;
                        }
                    }
                    defaultColorMap[route.id] = regionColor;
                }
            }
            if (Object.keys(defaultColorMap).length > 0) {
                this.travelMap.setRouteColors(defaultColorMap);
            }

            // Exception cross-region routes use destination region color
            // Reverse cross-region routes use destination region color
            const crossRegionColorMap = {};
            for (const card of this.configPanel.getRegionCards()) {
                if (!card.isEnabled()) continue;
                for (const exRoute of (card.exceptionRoutes || [])) {
                    if (!statusMap[exRoute.id]) {
                        crossRegionColorMap[exRoute.id] = FACTION_COLORS_MAP[exRoute.toRegion] || '#888';
                    }
                }
                for (const route of card.routes) {
                    // Reverse routes: the map route should use the destination color of the ORIGINAL route
                    // (reverse "B to A" in origin card → original "A to B" → destination is B's region)
                    if (route._isReverse && route._originalId && !statusMap[route._originalId]) {
                        // The original route name is "A to B", reverse is "B to A"
                        // We want the color of B's region (the original destination)
                        const parts = (route.name || '').split(' to ');
                        if (parts.length === 2) {
                            // route.name is "B to A" (reversed), so parts[1] = A = original from = origin region
                            // We want the original destination = parts[0] of the ORIGINAL route
                            // Since reverse flips, the original "to" is now parts[0] of the reverse name... wait no.
                            // Reverse name: "Myriadian Arc to Kildome Cross" (original: "Kildome Cross to Myriadian Arc")
                            // parts[0] = "Myriadian Arc" = original destination → wrentmark
                            const origDestRegion = LOCATION_CANONICAL_REGION[parts[0].trim()];
                            if (origDestRegion) {
                                crossRegionColorMap[route._originalId] = FACTION_COLORS_MAP[origDestRegion] || '#888';
                            }
                        }
                    }
                }
            }
            if (Object.keys(crossRegionColorMap).length > 0) {
                this.travelMap.setRouteColors(crossRegionColorMap);
            }
        }

        // Hide routes for disabled regions (using region cards which know their routes)
        if (this.configPanel) {
            const enabledRegions = new Set();
            for (const card of this.configPanel.getRegionCards()) {
                if (card.isEnabled()) {
                    enabledRegions.add(card.getRegion().id);
                } else {
                    // Hide this region's routes (use _originalId for reverse routes)
                    const routeIds = card.routes.map(r => r._originalId || r.id);
                    if (routeIds.length) this.travelMap.setRouteVisibility(routeIds, false);
                    // Also hide exception routes originating from this region
                    for (const exRoute of (card.exceptionRoutes || [])) {
                        this.travelMap.setRouteVisibility([exRoute.id], false);
                    }
                }
            }
            // Hide exception routes whose destination region is disabled
            for (const card of this.configPanel.getRegionCards()) {
                for (const exRoute of (card.exceptionRoutes || [])) {
                    if (!enabledRegions.has(exRoute.toRegion)) {
                        this.travelMap.setRouteVisibility([exRoute.id], false);
                    }
                }
            }
        }
    }

    /**
     * Check if all polling tasks are done and update Generate All button state.
     */
    _checkAllTasksDone() {
        if (!this._pollingTasks) return;
        const activeCount = Object.keys(this._pollingTasks).length;
        if (activeCount === 0) {
            this._setGenerateAllLoading(false);
        }
    }

    /**
     * Set the Generate All button loading state.
     * Req 13.3: Disable and show loading state while any task is running.
     * @param {boolean} loading
     */
    _setGenerateAllLoading(loading) {
        if (!this.configPanel) return;
        const btn = this.configPanel.el?.querySelector('#travel-generate-all-btn');
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.classList.add('loading');
            btn.innerHTML = '<span class="travel-gearset-spinner travel-gearset-spinner--inline"></span> Generating…';
        } else {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = '▶ Generate All';
        }
    }

    /**
     * Debounced save of travel config to backend.
     * Saves within 1 second of any change (Req 8.2).
     */
    _saveTravelConfig(immediate = false) {
        clearTimeout(this._saveTimer);
        const doSave = async () => {
            try {
                await fetch('/api/travel-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ config: this._travelConfig }),
                });
            } catch (err) {
                console.warn('[TravelConfigPage] Failed to save travel config:', err);
            }
        };
        if (immediate) {
            doSave();
        } else {
            this._saveTimer = setTimeout(doSave, 800);
        }
    }

    onNavigatedAway() {
        // Stop all active polling when leaving the page
        if (this._pollingTasks) {
            for (const taskKey of Object.keys(this._pollingTasks)) {
                clearInterval(this._pollingTasks[taskKey]);
            }
            this._pollingTasks = {};
        }
    }
}
