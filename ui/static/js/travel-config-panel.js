import { showInfoPopover, wireInfoIcons } from './info-popover.js';

/**
 * ConfigPanel - Scrollable configuration panel for the Travel Config page.
 *
 * Renders TopControls(Generate All, Clear All, Show Exception Routes,
 * Show Movement Activities) and a RegionCard for each game region.
 *
 * Requirements: 3.9, 6.1, 6.2, 7.1, 7.2, 13.1
 */

import RegionCard from './travel-region-card.js';
import MovementActivitiesSection from './travel-movement-activities.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Region definitions in display order.
 * `factions` lists the route-data faction values that belong to this region.
 */
const REGIONS = [
    { id: 'jarvonia', name: 'Jarvonia', factions: ['jarvonia'], color: '#bbdefa' },
    { id: 'trellin', name: 'Trellin', factions: ['gdte'], color: '#a0e870' },
    { id: 'erdwise', name: 'Erdwise', factions: ['gdte'], color: '#fec08d' },
    { id: 'halfling_rebels', name: 'Halfling Rebels', factions: ['gdte'], color: '#b8c375' },
    { id: 'syrenthia', name: 'Syrenthia', factions: ['syrenthia'], color: '#c7b6fc' },
    { id: 'wallisia', name: 'Wallisia', factions: ['wallisia'], color: '#e8a060' },
    { id: 'wrentmark', name: 'Wrentmark', factions: ['wrentmark'], color: '#f0d080' },
];

/**
 * Location-to-subregion mapping for GDTE routes.
 * Routes are assigned to the sub-region of their first (from) location.
 */
const GDTE_LOCATION_REGION = {
    'Mangrove Forest': 'trellin',
    'Farsand Coast': 'trellin',
    'Salsfirth': 'trellin',
    'Granfiddich': 'trellin',
    'Granfiddich Shores': 'trellin',
    'Warrenfield': 'trellin',
    'Old Arena Ruins': 'erdwise',
    'Blackspell Port': 'erdwise',
    'Everhaven': 'erdwise',
    'Bilgemont Port': 'erdwise',
    'Red Coast': 'erdwise',
    'Witched Woods': 'halfling_rebels',
    'Halfling Campgrounds': 'halfling_rebels',
    'Halfmaw Hideout': 'halfling_rebels',
    'Bog Top': 'halfling_rebels',
    'Bog Bottom': 'halfling_rebels',
    // Underwater/Syrenthia locations that appear in gdte-faction routes
    'Kelp Forest': 'syrenthia',
};

/**
 * Explicit route overrides — some cross-subregion routes should be assigned
 * to the destination region rather than the origin region.
 */
const ROUTE_REGION_OVERRIDES = {
    'Salsfirth to Witched Woods': 'halfling_rebels',
    'Old Arena Ruins to Halfmaw Hideout': 'halfling_rebels',
    'Kelp Forest to Granfiddich Shores': 'syrenthia',
};

/**
 * Determine which sub-region a GDTE route belongs to based on its "from" location.
 * @param {Object} route - Route object with name "Location A to Location B"
 * @returns {string|null} Sub-region ID or null if not determinable
 */
function getGdteSubRegion(route) {
    // Check explicit overrides first
    if (ROUTE_REGION_OVERRIDES[route.name]) {
        return ROUTE_REGION_OVERRIDES[route.name];
    }
    const parts = (route.name || '').split(' to ');
    if (parts.length === 2) {
        const from = parts[0].trim();
        const to = parts[1].trim();
        // Use "from" location first, fall back to "to"
        return GDTE_LOCATION_REGION[from] || GDTE_LOCATION_REGION[to] || null;
    }
    return null;
}

/**
 * Canonical location → region mapping.
 * Used for exception route detection: a route is an exception when
 * the "from" location's region differs from the "to" location's region.
 * This is independent of the route's faction field.
 */
const LOCATION_CANONICAL_REGION = {
    // Jarvonia
    'Azurazera': 'jarvonia', 'Barbantok': 'jarvonia', 'Beach of Woes': 'jarvonia',
    'Black Eye Peak': 'jarvonia', 'Casbrant Fields': 'jarvonia', 'Centaham': 'jarvonia',
    'Coldington': 'jarvonia', 'Disenchanted Forest': 'jarvonia',
    'Fort of Permafrost': 'jarvonia', 'Frostbite Mountain': 'jarvonia',
    'Frusenholm': 'jarvonia', 'Horn of Respite': 'jarvonia', 'Kallaheim': 'jarvonia',
    'Nomad Woods': 'jarvonia', 'Norsack Plains': 'jarvonia',
    'Nurturing Nook Springs': 'jarvonia', 'Pit of Pittance': 'jarvonia',
    'Port Skildar': 'jarvonia', 'Sanguine Hills': 'jarvonia',
    'Winter Waves Glacier': 'jarvonia', "Winter's End": 'jarvonia',
    'Noiseless Pass': 'jarvonia',
    // Trellin (GDTE sub-region)
    'Mangrove Forest': 'trellin', 'Farsand Coast': 'trellin', 'Salsfirth': 'trellin',
    'Granfiddich': 'trellin', 'Granfiddich Shores': 'trellin', 'Warrenfield': 'trellin',
    // Erdwise (GDTE sub-region)
    'Old Arena Ruins': 'erdwise', 'Blackspell Port': 'erdwise', 'Everhaven': 'erdwise',
    'Bilgemont Port': 'erdwise', 'Red Coast': 'erdwise',
    // Halfling Rebels (GDTE sub-region)
    'Witched Woods': 'halfling_rebels', 'Halfling Campgrounds': 'halfling_rebels',
    'Halfmaw Hideout': 'halfling_rebels', 'Bog Top': 'halfling_rebels',
    'Bog Bottom': 'halfling_rebels',
    // Syrenthia
    "Casbrant's Grave": 'syrenthia', 'Vastalume': 'syrenthia', 'Kelp Forest': 'syrenthia',
    'Darktide Trench': 'syrenthia', "Elara's Lagoon": 'syrenthia',
    'Underwater Cave': 'syrenthia',
    // Wallisia
    'Tendon Wet Fields': 'wallisia', 'Stalking Yew Woods': 'wallisia',
    'Blackwater Fields': 'wallisia', 'Blackrane': 'wallisia', 'Kildome Cross': 'wallisia',
    'Wraithwater': 'wallisia',
    // Wrentmark
    'Myriadian Arc': 'wrentmark', 'Crown of Cinders': 'wrentmark',
};

/**
 * Exception routes: cross-region routes where gear requirements are unusual
 * for the starting region. For example, Granfiddich Shores → Kelp Forest
 * needs diving gear which is unusual for Trellin, so it's an exception
 * under Trellin. But Kelp Forest → Granfiddich Shores also needs diving
 * gear, which is normal for Syrenthia — so it's NOT an exception.
 *
 * When routes.json only has one direction, we check if the gear requirement
 * is unusual for the "from" region. If it's normal for "from" but unusual
 * for "to", we flip the direction so the exception is attributed correctly.
 *
 * @param {Object[]} routes - All routes from routes.json
 * @returns {Object[]} Array of exception route objects
 */

/** Patterns that indicate a gearset-equippable requirement (case-insensitive). */
const GEARSET_REQUIREMENT_PATTERNS = [
    /diving gear/i,
    /skis equipped/i,
    /light source/i,
];

function isGearsetRequirement(req) {
    return GEARSET_REQUIREMENT_PATTERNS.some(pat => pat.test(req));
}

/**
 * Gear requirements that are "normal" for a region — routes within these
 * regions commonly need this gear, so it's not exceptional.
 */
const REGION_NORMAL_GEAR = {
    syrenthia: [/diving gear/i],
    halfling_rebels: [/light source/i],
    jarvonia: [/skis/i],
};

/** Check if a gear requirement is normal for a given region. */
function isGearNormalForRegion(req, regionId) {
    const patterns = REGION_NORMAL_GEAR[regionId] || [];
    return patterns.some(pat => pat.test(req));
}

function detectExceptionRoutes(routes) {
    const exceptions = [];
    for (const route of routes) {
        const parts = (route.name || '').split(' to ');
        if (parts.length !== 2) continue;
        const from = parts[0].trim();
        const to = parts[1].trim();

        const fromRegion = LOCATION_CANONICAL_REGION[from];
        const toRegion = LOCATION_CANONICAL_REGION[to];
        if (!fromRegion || !toRegion) continue;

        // Only cross-region routes are candidates
        if (fromRegion === toRegion) continue;

        const allReqs = route.terrainModifiers || [];
        const gearsetReqs = allReqs.filter(isGearsetRequirement);
        if (!gearsetReqs.length) continue;

        // Check if the gear requirements are unusual for the "from" region
        const unusualForFrom = gearsetReqs.some(r => !isGearNormalForRegion(r, fromRegion));
        // Check if they'd be unusual for the "to" region (reverse direction)
        const unusualForTo = gearsetReqs.some(r => !isGearNormalForRegion(r, toRegion));

        if (unusualForFrom) {
            // Normal case: gear is unusual for the starting region
            // e.g., Port Skildar → Casbrant's Grave (diving unusual for Jarvonia)
            exceptions.push({
                id: route.id,
                name: `${from} → ${to}`,
                faction: route.faction,
                fromRegion,
                toRegion,
                fromLocation: from,
                toLocation: to,
                flipped: false,
                unmetRequirements: gearsetReqs,
            });
        } else if (unusualForTo) {
            // Reverse case: gear is normal for "from" but unusual for "to"
            // e.g., Kelp Forest → Granfiddich Shores (diving normal for Syrenthia)
            // Flip it: the exception is Granfiddich Shores → Kelp Forest under Trellin
            exceptions.push({
                id: route.id,
                name: `${to} → ${from}`,
                faction: route.faction,
                fromRegion: toRegion,
                toRegion: fromRegion,
                fromLocation: to,
                toLocation: from,
                flipped: true,
                unmetRequirements: gearsetReqs,
            });
        }
        // If gear is normal for both regions, skip (shouldn't happen in practice)
    }
    return exceptions;
}

export { REGIONS, detectExceptionRoutes, LOCATION_CANONICAL_REGION };

// ============================================================================
// CONFIGPANEL CLASS
// ============================================================================

export default class ConfigPanel {
    /**
     * @param {HTMLElement} element - Container element (#travel-config-panel-content)
     * @param {Object} opts
     * @param {Object}   opts.config       - Travel_Config_Store reference
     * @param {Object[]} opts.routes       - All route markers from routes.json
     * @param {Function} opts.onConfigChange - Called when any config value changes
     * @param {Function} opts.onOptimize     - Called with (taskKey, payload) to start optimization
     * @param {Function} opts.onGenerateAll  - Called to trigger Generate All
     */
    constructor(element, opts = {}) {
        this.el = typeof element === 'string' ? document.querySelector(element) : element;
        this.config = opts.config || {};
        this.routes = opts.routes || [];
        this.locations = opts.locations || [];
        this.onConfigChange = opts.onConfigChange || (() => { });
        this.onOptimize = opts.onOptimize || (() => { });
        this.onGenerateAll = opts.onGenerateAll || (() => { });
        this.onRouteColorChange = opts.onRouteColorChange || (() => { });
        this.onPanToRoute = opts.onPanToRoute || (() => { });

        // Build location icon lookup: { "Kallaheim": "castle_white", ... }
        this._locationIcons = {};
        for (const loc of this.locations) {
            const iconBase = (loc.icon?.url || '')
                .replace('locations/', '').replace('.png', '');
            if (iconBase) this._locationIcons[loc.name] = iconBase;
        }

        /** @type {RegionCard[]} */
        this.regionCards = [];

        /** @type {MovementActivitiesSection|null} */
        this.movementSection = null;

        // Clear All two-click state
        this._clearAllPending = false;
        this._clearAllTimer = null;

        this._render();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _render() {
        if (!this.el) return;
        this.el.innerHTML = '';

        // Top controls
        const topControls = document.createElement('div');
        topControls.className = 'travel-top-controls';
        topControls.innerHTML = this._renderTopControls();
        this.el.appendChild(topControls);
        this._topControlsEl = topControls;

        // Locked gear slots warning banner
        if (window.settingsModal?.lockCurrentGearSlots) {
            const warningBanner = document.createElement('div');
            warningBanner.className = 'travel-locked-slots-warning';
            this.el.appendChild(warningBanner);
            // Populate asynchronously (needs catalog data)
            this._renderLockedSlotsWarning().then(html => {
                warningBanner.innerHTML = html;
            });
        }

        // Region cards container
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'travel-region-cards';
        this.el.appendChild(cardsContainer);

        // Detect cross-region routes from route data
        const allExceptions = detectExceptionRoutes(this.routes);
        const exceptionsConfig = this.config.exceptions || {};

        // Build region cards
        this.regionCards = [];
        for (const region of REGIONS) {
            const regionConfig = this.config.regions?.[region.id] || {};

            const regionRoutes = this._getRoutesForRegion(region);
            const routeCount = regionRoutes.length;

            // Cross-region routes for this region (shown inline in the card)
            const inlineExceptions = allExceptions.filter(ex => ex.fromRegion === region.id);

            const cardEl = document.createElement('div');
            cardsContainer.appendChild(cardEl);

            const card = new RegionCard(cardEl, {
                region,
                routeCount,
                routes: regionRoutes,
                locationIcons: this._locationIcons,
                regionConfig,
                exceptionRoutes: inlineExceptions,
                exceptionsConfig,
                onConfigChange: (key, value) => {
                    // Propagate region config changes
                    if (!this.config.regions) this.config.regions = {};
                    if (!this.config.regions[region.id]) this.config.regions[region.id] = {};
                    this.config.regions[region.id][key] = value;
                    this.onConfigChange();
                    // When a region is enabled/disabled, update cross-region exception routes
                    if (key === 'enabled') {
                        this._updateExceptionVisibility();
                    }
                },
                onExceptionConfigChange: (routeId, key, value) => {
                    if (!this.config.exceptions) this.config.exceptions = {};
                    if (!this.config.exceptions[routeId]) this.config.exceptions[routeId] = { gearset: {} };
                    if (key !== 'import') {
                        this.config.exceptions[routeId][key] = value;
                        this.onConfigChange();
                    }
                },
                onRouteColorChange: (routeIds, color) => {
                    this.onRouteColorChange(routeIds, color);
                },
                onPanToRoute: (routeId) => {
                    this.onPanToRoute(routeId);
                },
                onOptimize: this.onOptimize,
            });
            this.regionCards.push(card);
        }

        // Movement Activities section (Req 7.1, 7.3) — shown when checkbox is checked
        const showMovement = this.config.show_movement_activities || false;
        this.movementSection = null;
        if (showMovement) {
            const enabledRegions = {};
            for (const region of REGIONS) {
                enabledRegions[region.id] = !!(this.config.regions?.[region.id]?.enabled);
            }
            const movEl = document.createElement('div');
            movEl.className = 'travel-movement-section';
            this.el.appendChild(movEl);
            this.movementSection = new MovementActivitiesSection(movEl, {
                config: this.config,
                enabledRegions,
                hasRingOfHomesickness: this.config._has_ring_of_homesickness || false,
                onConfigChange: () => this.onConfigChange(),
                onOptimize: this.onOptimize,
            });
        }

        this._attachEvents();
    }

    _renderTopControls() {
        const showMovement = this.config.show_movement_activities || false;

        return `
            <div class="travel-top-buttons">
                <button class="button button-primary travel-generate-all-btn" id="travel-generate-all-btn">
                    ▶ Generate All
                </button>
                <button class="button travel-clear-all-btn" id="travel-clear-all-btn">
                    Reset All
                </button>
            </div>
            <div class="travel-top-checkboxes">
                <label class="travel-checkbox-label">
                    <input type="checkbox" id="travel-show-movement" ${showMovement ? 'checked' : ''} />
                    <span>Show Movement Activities</span>
                    <span class="travel-info-icon" data-info="Movement activities are special activities (e.g., Run for Your Life, Explore Bog Bottom) that act as shortcuts between locations and require their own gearset optimization.">ⓘ</span>
                </label>
            </div>
        `;
    }

    _attachEvents() {
        // Generate All
        const genBtn = this.el.querySelector('#travel-generate-all-btn');
        if (genBtn) {
            genBtn.addEventListener('click', () => this.onGenerateAll());
        }

        // Clear All (two-click confirmation)
        const clearBtn = this.el.querySelector('#travel-clear-all-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this._onClearAllClick(clearBtn));
        }

        // Show Movement Activities checkbox
        const movementCheck = this.el.querySelector('#travel-show-movement');
        if (movementCheck) {
            movementCheck.addEventListener('change', (e) => {
                this.config.show_movement_activities = e.target.checked;
                this.onConfigChange();
                this._render();
            });
        }

        // Info icons — hover + click popover behavior
        wireInfoIcons(this.el);
    }

    // -------------------------------------------------------------------------
    // Clear All — two-click confirmation
    // -------------------------------------------------------------------------

    _onClearAllClick(btn) {
        if (this._clearAllPending) {
            this._clearAllPending = false;
            clearTimeout(this._clearAllTimer);
            btn.textContent = 'Reset All';
            btn.classList.remove('confirm');
            this._executeClearAll();
        } else {
            this._clearAllPending = true;
            btn.textContent = 'Are you sure?';
            btn.classList.add('confirm');
            this._clearAllTimer = setTimeout(() => {
                this._clearAllPending = false;
                btn.textContent = 'Reset All';
                btn.classList.remove('confirm');
            }, 3000);
        }
    }

    _executeClearAll() {
        // Fully reset all gearset assignments across all regions
        if (this.config.regions) {
            for (const regionId of Object.keys(this.config.regions)) {
                this.config.regions[regionId].gearsets = {};
                this.config.regions[regionId].breakpoint = null;
                this.config.regions[regionId].mode = 'single';
                this.config.regions[regionId].multi_count = 2;
            }
        }
        // Clear exception gearsets (cross-region routes)
        if (this.config.exceptions) {
            for (const key of Object.keys(this.config.exceptions)) {
                this.config.exceptions[key].gearset = {};
            }
        }
        this.onConfigChange();
        // Reset route colors to faction defaults per region
        for (const region of REGIONS) {
            const regionCfg = this.config.regions?.[region.id];
            if (!regionCfg?.enabled) continue;
            const regionRoutes = this._getRoutesForRegion(region);
            const regionRouteIds = regionRoutes.map(r => r._originalId || r.id);
            if (regionRouteIds.length) {
                this.onRouteColorChange(regionRouteIds, region.color);
            }
            // Major cross-region routes: use destination region color
            for (const route of regionRoutes) {
                if (route._oneWay && !route._isReverse) {
                    const parts = (route.name || '').split(' to ');
                    if (parts.length === 2) {
                        const toRegion = LOCATION_CANONICAL_REGION[parts[1].trim()];
                        if (toRegion && toRegion !== region.id) {
                            const destRegionDef = REGIONS.find(r => r.id === toRegion);
                            const destColor = destRegionDef?.color || '#888';
                            this.onRouteColorChange([route.id], destColor);
                        }
                    }
                }
            }
        }
        // Reset exception route colors to destination region defaults
        const allExceptions = detectExceptionRoutes(this.routes);
        for (const exRoute of allExceptions) {
            const destRegionDef = REGIONS.find(r => r.id === exRoute.toRegion);
            const destColor = destRegionDef?.color || '#888';
            this.onRouteColorChange([exRoute.id], destColor);
        }
        // Re-render all region cards
        for (const card of this.regionCards) {
            card.refresh();
        }
    }

    // -------------------------------------------------------------------------
    // Cross-region exception visibility
    // -------------------------------------------------------------------------

    /**
     * Update exception route visibility when regions are enabled/disabled.
     * - Hides exception routes on the map when their destination region is disabled
     * - Re-renders cards to show/hide cross-region route sections
     */
    _updateExceptionVisibility() {
        const allExceptions = detectExceptionRoutes(this.routes);

        // Build set of enabled region IDs
        const enabledRegions = new Set();
        for (const region of REGIONS) {
            if (this.config.regions?.[region.id]?.enabled) {
                enabledRegions.add(region.id);
            }
        }

        // Hide/show exception routes on the map based on destination region
        if (window.travelMap) {
            for (const exRoute of allExceptions) {
                const destEnabled = enabledRegions.has(exRoute.toRegion);
                const fromEnabled = enabledRegions.has(exRoute.fromRegion);
                // Show only if both origin and destination regions are enabled
                window.travelMap.setRouteVisibility([exRoute.id], destEnabled && fromEnabled);
            }
        }

        // Re-render cards to update cross-region route sections
        for (const card of this.regionCards) {
            const region = card.getRegion();
            // Filter exception routes: only show if destination region is enabled
            const inlineExceptions = allExceptions.filter(ex =>
                ex.fromRegion === region.id && enabledRegions.has(ex.toRegion)
            );
            card.setExceptionRoutes(inlineExceptions, this.config.exceptions || {});
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Count routes belonging to a region.
     * GDTE routes are split by sub-region using location name heuristics from
     * the route data. For now we use the route's `region` field if present,
     * otherwise fall back to faction.
     */
    _countRoutesForRegion(region) {
        return this._getRoutesForRegion(region).length;
    }

    /**
     * Get the routes belonging to a region, properly splitting GDTE by sub-region.
     * Uses LOCATION_CANONICAL_REGION for the "from" location to assign cross-region
     * routes to the correct starting region.
     * @param {Object} region - Region definition from REGIONS
     * @returns {Object[]} Array of route objects
     */
    _getRoutesForRegion(region) {
        // Pre-compute which route IDs are cross-region exceptions (have gear requirements)
        const allExceptions = detectExceptionRoutes(this.routes);
        const exceptionOriginalIds = new Set(allExceptions.map(ex => ex.id));

        const result = this.routes.filter(route => {
            // Use canonical region of the "from" and "to" locations for accurate assignment
            const parts = (route.name || '').split(' to ');
            if (parts.length === 2) {
                const from = parts[0].trim();
                const to = parts[1].trim();
                const fromRegion = LOCATION_CANONICAL_REGION[from];
                const toRegion = LOCATION_CANONICAL_REGION[to];
                if (fromRegion && toRegion) {
                    if (fromRegion === toRegion) {
                        // Same-region route: assign to that region
                        return fromRegion === region.id;
                    }
                    // Cross-region route: check if it's GDTE-internal (trellin/erdwise/halfling_rebels)
                    const gdteRegions = new Set(['trellin', 'erdwise', 'halfling_rebels']);
                    const isGdteInternal = gdteRegions.has(fromRegion) && gdteRegions.has(toRegion);
                    if (isGdteInternal) {
                        // GDTE internal: assign to origin (bidirectional within GDTE)
                        return fromRegion === region.id;
                    }
                    // Major cross-region: assign to destination
                    return toRegion === region.id;
                }
                // Only from is known: use it
                if (fromRegion) return fromRegion === region.id;
            }

            // Fallback: standard faction-based assignment
            if (route.faction === region.id) return true;
            if (route.faction === 'gdte') {
                const subRegion = getGdteSubRegion(route);
                if (subRegion === region.id) return true;
            }

            return false;
        });

        // Mark major cross-region routes as one-way (skip GDTE internal crossings — they're bidirectional)
        const gdteSet = new Set(['trellin', 'erdwise', 'halfling_rebels']);
        for (const route of [...result]) {
            const parts = (route.name || '').split(' to ');
            if (parts.length !== 2) continue;
            const from = parts[0].trim();
            const to = parts[1].trim();
            const fromRegion = LOCATION_CANONICAL_REGION[from];
            const toRegion = LOCATION_CANONICAL_REGION[to];
            if (!fromRegion || !toRegion || fromRegion === toRegion) continue;

            // GDTE internal crossings are bidirectional (not one-way)
            if (gdteSet.has(fromRegion) && gdteSet.has(toRegion)) continue;

            // Major cross-region route — mark as one-way
            route._oneWay = true;
        }

        // Add reverse directions of major cross-region routes as one-way routes
        // in the origin region (since the forward route is in the destination card).
        // GDTE internal crossings don't need reverse routes (they're bidirectional in origin card).
        for (const route of this.routes) {
            const parts = (route.name || '').split(' to ');
            if (parts.length !== 2) continue;
            const from = parts[0].trim();
            const to = parts[1].trim();
            const fromRegion = LOCATION_CANONICAL_REGION[from];
            const toRegion = LOCATION_CANONICAL_REGION[to];
            if (!fromRegion || !toRegion || fromRegion === toRegion) continue;

            // Skip GDTE internal crossings — they're bidirectional in the origin card
            if (gdteSet.has(fromRegion) && gdteSet.has(toRegion)) continue;

            // Reverse goes to the origin region (fromRegion)
            if (fromRegion !== region.id) continue;

            // For exception routes: check if gear is normal for the reverse starting region (toRegion)
            if (exceptionOriginalIds.has(route.id)) {
                const gearReqs = (route.terrainModifiers || []).filter(isGearsetRequirement);
                const allNormal = gearReqs.length > 0 && gearReqs.every(req => isGearNormalForRegion(req, toRegion));
                if (!allNormal) continue;
            }

            result.push({
                ...route,
                id: `reverse:${route.id}`,
                name: `${to} to ${from}`,
                _isReverse: true,
                _oneWay: true,
                _originalId: route.id,
            });
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Update config and re-render all cards */
    setConfig(config) {
        this.config = config;
        this._render();
    }

    /** Update routes data (e.g. after map loads) */
    setRoutes(routes) {
        this.routes = routes;
        this._render();
    }

    /** Get all region cards */
    getRegionCards() {
        return this.regionCards;
    }

    destroy() {
        clearTimeout(this._clearAllTimer);
        for (const card of this.regionCards) {
            card.destroy();
        }
        this.regionCards = [];
        if (this.movementSection) {
            this.movementSection.destroy();
            this.movementSection = null;
        }
        if (this.el) this.el.innerHTML = '';
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Build gear preview HTML from a gearset export string.
     * Mirrors RegionCard._buildGearPreviewHtml.
     */
    async _renderLockedSlotsWarning() {
        // Build a mini gear preview of locked slots
        const currentGear = window.store?.state?.gearsets?.current || {};
        const lockedSlots = {};
        for (const [slot, item] of Object.entries(currentGear)) {
            if (item && item.itemId) {
                lockedSlots[slot] = item;
            }
        }

        if (Object.keys(lockedSlots).length === 0) {
            return `
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(255, 193, 7, 0.12); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; margin-bottom: 8px;">
                    <span style="font-size: 1.1em;">⚠️</span>
                    <span style="color: var(--text-secondary); font-size: 0.85em;">Gear set slot locking enabled — no slots currently equipped</span>
                </div>
            `;
        }

        // Build mini preview of locked items
        let catalogByUuid = {};
        let catalogById = {};
        try {
            const resp = await window.api.getCatalog();
            for (const item of (resp.items || [])) {
                catalogById[item.id] = item;
                if (item.uuid) catalogByUuid[item.uuid] = item;
            }
        } catch (_) { }

        const QUALITY_TO_RARITY = {
            common: 'rarity-common', uncommon: 'rarity-uncommon', rare: 'rarity-rare',
            epic: 'rarity-epic', legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
        };

        const lockedIcons = Object.entries(lockedSlots).map(([slot, item]) => {
            const catalogItem = catalogByUuid[item.itemId] || catalogById[item.itemId] || {};
            const qualityKey = (item.quality || catalogItem.rarity || '').toLowerCase();
            const rarityClass = QUALITY_TO_RARITY[qualityKey] || '';
            const icon = catalogItem.icon_path || '';
            const name = catalogItem.name || item.itemId || '';
            return `<div class="travel-gear-mini-slot ${rarityClass}" title="${name} (locked)" style="width: 28px; height: 28px; border: 1px solid rgba(255, 193, 7, 0.5);">
                ${icon ? `<img src="${icon}" alt="${name}" class="travel-gear-mini-icon" loading="lazy" style="width: 22px; height: 22px;" />` : ''}
            </div>`;
        }).join('');

        return `
            <div style="padding: 8px 12px; background: rgba(255, 193, 7, 0.12); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 6px; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="font-size: 1.1em;">⚠️</span>
                    <span style="color: var(--text-secondary); font-size: 0.85em; font-weight: 500;">Gear set slot locking enabled</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 3px;">
                    ${lockedIcons}
                </div>
            </div>
        `;
    }
}
