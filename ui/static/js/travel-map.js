/**
 * TravelMap - Leaflet map wrapper for the Travel Config page.
 *
 * Renders all game locations and routes from the map data files.
 * Routes are color-coded by assignment/validation status and can be
 * focused per RouteGearset. Supports a draggable legend and mobile
 * focus-mode overlay.
 *
 * Requirements: 2.1–2.9, 11.5–11.16
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const FACTION_COLORS = {
    jarvonia: '#bbdefa',
    gdte: '#a0e870',
    syrenthia: '#c7b6fc',
    halfling_rebels: '#b8c375',
    erdwise: '#fec08d',
    wallisia: '#e8a060',
    wrentmark: '#f0d080',
};

// Route status colors
const STATUS_COLORS = {
    assigned_unmet: '#e05050',
    unassigned: '#555555',
};

// Coordinate transform constants (empirically calibrated in maptest.html)
const COORD_SCALE = 0.25;
const TILE_OFFSET_X = 719;
const TILE_OFFSET_Y = 738;

// ============================================================================
// COORDINATE HELPERS
// ============================================================================

/**
 * Convert JSON [row, col] coords to a Leaflet LatLng.
 * JSON coords are [row, col] — axes are swapped from typical x,y.
 * @param {number[]} coords - [row, col]
 * @returns {L.LatLng}
 */
function toLng(coords) {
    return L.latLng(
        -(coords[0] + TILE_OFFSET_Y) * COORD_SCALE,
        (coords[1] + TILE_OFFSET_X) * COORD_SCALE
    );
}

/**
 * Interpolate evenly-spaced points along a polyline.
 * @param {L.LatLng[]} pts - Array of LatLng points
 * @param {number} spacing - Desired spacing in map units between points
 * @returns {L.LatLng[]}
 */
function interpolatePoints(pts, spacing) {
    if (pts.length < 2) return pts.slice();
    // Calculate total length
    const segs = [];
    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].lng - pts[i - 1].lng;
        const dy = pts[i].lat - pts[i - 1].lat;
        const len = Math.sqrt(dx * dx + dy * dy);
        segs.push({ from: pts[i - 1], to: pts[i], len });
        totalLen += len;
    }
    if (totalLen === 0) return [pts[0]];
    const count = Math.max(2, Math.round(totalLen / spacing));
    const step = totalLen / count;
    const result = [];
    let segIdx = 0, segDist = 0;
    for (let i = 0; i <= count; i++) {
        const target = i * step;
        let accumulated = 0;
        segIdx = 0;
        for (let j = 0; j < segs.length; j++) {
            if (accumulated + segs[j].len >= target || j === segs.length - 1) {
                segIdx = j;
                segDist = target - accumulated;
                break;
            }
            accumulated += segs[j].len;
        }
        const seg = segs[segIdx];
        const t = seg.len > 0 ? Math.min(1, segDist / seg.len) : 0;
        result.push(L.latLng(
            seg.from.lat + (seg.to.lat - seg.from.lat) * t,
            seg.from.lng + (seg.to.lng - seg.from.lng) * t
        ));
    }
    return result;
}

// ============================================================================
// TRAVELMAP CLASS
// ============================================================================

export default class TravelMap {
    /**
     * @param {HTMLElement} element - Container element for the Leaflet map
     */
    constructor(element) {
        this.element = element;
        this.map = null;

        // { routeId: { outer, ring, fill, tooltip } }
        this.routeLayers = {};

        // { routeId: { status, color, steps } }
        this.routeStatusMap = {};

        // { gearsetId: { name, color, routeIds } }
        this.routeGearsets = {};

        // Focus state
        this.focusedGearsetId = null;

        // Set of route IDs that are hidden (disabled regions)
        this._hiddenRouteIds = new Set();

        // { locationName: { icon: L.marker, label: L.marker } }
        this.locationLayers = {};

        // Raw data
        this.locations = [];
        this.routes = [];

        // Legend element (created after data loads)
        this._legendEl = null;

        // Focus overlay element (mobile)
        this._focusOverlayEl = null;

        // Callback when a route is clicked on the map
        this.onRouteClick = null;
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /**
     * Initialize the Leaflet map, load data, and render everything.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async init() {
        if (this.map) return;

        this._initLeaflet();
        await this._loadMapData();
        this._renderRoutes();
        this._renderLocations();
        this._renderLegend();
        this._renderFocusOverlay();
    }

    _initLeaflet() {
        this.map = L.map(this.element, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: 5,
            zoomSnap: 1,
            zoomDelta: 1,
            attributionControl: false,
        });

        L.tileLayer('/static/assets/map/tiles/{z}/{x}_{y}.png', {
            tileSize: 512,
            minZoom: 0,
            maxZoom: 5,
            maxNativeZoom: 4,
            noWrap: true,
            errorTileUrl: '',
        }).addTo(this.map);

        // Rebuild diamond markers on zoom so spacing stays consistent in screen pixels
        this.map.on('zoomend', () => this._rebuildDiamonds());
    }

    /**
     * Get the diamond spacing in map units for the current zoom level.
     * Targets ~20 screen pixels between diamonds.
     */
    _getDiamondSpacing() {
        if (!this.map) return 3.5;
        try {
            const center = this.map.getCenter();
            const p1 = this.map.latLngToContainerPoint(center);
            const p2 = L.point(p1.x + 20, p1.y);
            const ll2 = this.map.containerPointToLatLng(p2);
            const dx = ll2.lng - center.lng;
            const dy = ll2.lat - center.lat;
            return Math.sqrt(dx * dx + dy * dy) || 3.5;
        } catch (e) {
            // Map view not set yet — use a reasonable default
            return 3.5;
        }
    }

    /**
     * Rebuild all visible diamond marker groups at the current zoom spacing.
     */
    _rebuildDiamonds() {
        const spacing = this._getDiamondSpacing();
        for (const route of this.routes) {
            const layers = this.routeLayers[route.id];
            if (!layers || !layers._diamondsVisible) continue;

            // Remove old diamonds
            if (layers.diamondGroup) layers.diamondGroup.remove();

            // Rebuild at new spacing
            const pts = route.pathpoints.map(p => toLng(p));
            const diamondPts = interpolatePoints(pts, spacing);
            const newGroup = L.layerGroup();
            for (const pt of diamondPts) {
                const icon = L.divIcon({
                    className: 'travel-diamond-marker',
                    html: '<div class="travel-diamond-inner"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8],
                });
                L.marker(pt, { icon, interactive: false, pane: 'overlayPane' }).addTo(newGroup);
            }
            newGroup.addTo(this.map);
            layers.diamondGroup = newGroup;

            // Re-apply stored colors
            const fillColor = layers._diamondFillColor || '#e05050';
            const ringColor = layers._diamondRingColor || '#800020';

            // Determine focus opacity (dim if in focus mode and this route isn't focused)
            let focusOpacity = '1';
            if (this.focusedGearsetId) {
                let focusedIds = null;
                if (this.focusedGearsetId === '__custom__') {
                    // Custom focus — check _lastFocusedRouteIds
                    focusedIds = this._lastFocusedRouteIds;
                } else {
                    const gs = this.routeGearsets[this.focusedGearsetId];
                    if (gs) focusedIds = new Set(gs.routeIds || []);
                }
                if (focusedIds && !focusedIds.has(route.id)) {
                    focusOpacity = '0.08';
                }
            }

            newGroup.eachLayer(m => {
                const el = m.getElement?.();
                if (!el) return;
                el.style.opacity = focusOpacity;
                const inner = el.querySelector('.travel-diamond-inner');
                if (inner) {
                    inner.style.setProperty('--diamond-fill', fillColor);
                }
            });
        }
    }

    async _loadMapData() {
        try {
            const [locResp, routeResp] = await Promise.all([
                fetch('/static/assets/map/data/locations.json'),
                fetch('/static/assets/map/data/routes.json'),
            ]);
            const locData = await locResp.json();
            const routeData = await routeResp.json();

            // Flatten groups
            for (const g of locData) {
                if (g.name === 'Locations') this.locations.push(...g.markers);
            }
            for (const g of routeData) {
                this.routes.push(...g.markers);
            }
        } catch (err) {
            console.error('[TravelMap] Failed to load map data:', err);
            // Non-fatal — map renders tiles only
        }
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _renderRoutes() {
        // Location-to-region mapping for cross-region route coloring.
        // Cross-region routes use the destination region's color on the base map.
        const LOC_REGION = {
            'Mangrove Forest': 'trellin', 'Farsand Coast': 'trellin', 'Salsfirth': 'trellin',
            'Granfiddich': 'trellin', 'Granfiddich Shores': 'trellin', 'Warrenfield': 'trellin',
            'Old Arena Ruins': 'erdwise', 'Blackspell Port': 'erdwise', 'Everhaven': 'erdwise',
            'Bilgemont Port': 'erdwise', 'Red Coast': 'erdwise',
            'Witched Woods': 'halfling_rebels', 'Halfling Campgrounds': 'halfling_rebels',
            'Halfmaw Hideout': 'halfling_rebels', 'Bog Top': 'halfling_rebels', 'Bog Bottom': 'halfling_rebels',
            "Casbrant's Grave": 'syrenthia', 'Vastalume': 'syrenthia', 'Kelp Forest': 'syrenthia',
            'Darktide Trench': 'syrenthia', "Elara's Lagoon": 'syrenthia', 'Underwater Cave': 'syrenthia',
            'Tendon Wet Fields': 'wallisia', 'Stalking Yew Woods': 'wallisia',
            'Blackwater Fields': 'wallisia', 'Blackrane': 'wallisia', 'Kildome Cross': 'wallisia',
            'Wraithwater': 'wallisia',
            'Myriadian Arc': 'wrentmark', 'Crown of Cinders': 'wrentmark',
        };

        for (const route of this.routes) {
            const pts = route.pathpoints.map(p => toLng(p));

            // Determine color: for major cross-region routes, use destination region color
            // GDTE internal crossings (trellin/erdwise/halfling_rebels) use origin color
            let color = FACTION_COLORS[route.faction] || '#888';
            const parts = (route.name || '').split(' to ');
            if (parts.length === 2) {
                const fromRegion = LOC_REGION[parts[0].trim()];
                const toRegion = LOC_REGION[parts[1].trim()];
                if (fromRegion && toRegion && fromRegion !== toRegion) {
                    const gdteRegions = new Set(['trellin', 'erdwise', 'halfling_rebels']);
                    const isGdteInternal = gdteRegions.has(fromRegion) && gdteRegions.has(toRegion);
                    if (isGdteInternal) {
                        // GDTE internal: use origin region color
                        color = FACTION_COLORS[fromRegion] || color;
                    } else {
                        // Major cross-region: use destination region color
                        color = FACTION_COLORS[toRegion] || color;
                    }
                } else if (fromRegion) {
                    // Same region or only from known: use origin color (for GDTE sub-region coloring)
                    color = FACTION_COLORS[fromRegion] || color;
                }
            }

            // Three-layer dotted polyline: white → black → color
            const outer = L.polyline(pts, {
                color: 'white', weight: 18, opacity: 1,
                dashArray: '1, 28', lineCap: 'round',
            }).addTo(this.map);

            const ring = L.polyline(pts, {
                color: 'black', weight: 14, opacity: 1,
                dashArray: '1, 28', lineCap: 'round',
            }).addTo(this.map);

            const fill = L.polyline(pts, {
                color, weight: 10, opacity: 1,
                dashArray: '1, 28', lineCap: 'round',
            }).addTo(this.map);

            // Pre-create diamond markers at evenly-spaced intervals (hidden by default)
            // Spacing computed from current zoom to match ~20px screen spacing
            const diamondSpacing = this._getDiamondSpacing();
            const diamondPts = interpolatePoints(pts, diamondSpacing);
            const diamondGroup = L.layerGroup();
            for (const pt of diamondPts) {
                const icon = L.divIcon({
                    className: 'travel-diamond-marker',
                    html: '<div class="travel-diamond-inner"></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8],
                });
                L.marker(pt, { icon, interactive: false, pane: 'overlayPane' }).addTo(diamondGroup);
            }
            // Don't add to map yet — only shown when route is unmet/unassigned

            // Tooltip (sticky, shows on hover)
            const reqs = route.terrainModifiers && route.terrainModifiers.length
                ? '<br><em>' + route.terrainModifiers.join('<br>') + '</em>' : '';
            fill.bindTooltip(
                `<strong>${route.name}</strong><br>Distance: ${route.distance}${reqs}`,
                { className: 'travel-route-tip', sticky: true }
            );

            // Click: show route name in tooltip (desktop) / tap (mobile)
            fill.on('click', () => this._onRouteClick(route));

            this.routeLayers[route.id] = { outer, ring, fill, diamondGroup, _diamondsVisible: false };
        }
    }

    _renderLocations() {
        for (const loc of this.locations) {
            const pos = toLng(loc.coords);

            // Map JSON icon URL to local SVG
            const iconBase = (loc.icon?.url || 'locations/castle_white.png')
                .replace('locations/', '').replace('.png', '').toLowerCase();
            const iconUrl = `/assets/icons/locations/${iconBase}_icon.svg`;

            const iconMarker = L.marker(pos, {
                icon: L.icon({ iconUrl, iconSize: [32, 32], iconAnchor: [16, 16] }),
                zIndexOffset: 100,
            }).addTo(this.map);

            // Name label centered below icon
            const labelMarker = L.marker(pos, {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="travel-location-label">${loc.name}</div>`,
                    iconSize: null,
                    iconAnchor: [0, -20],
                }),
            }).addTo(this.map);

            this.locationLayers[loc.name] = { icon: iconMarker, label: labelMarker };
        }

        // Center on Kallaheim on first load
        const kh = this.locations.find(l => l.name === 'Kallaheim');
        if (kh) this.map.setView(toLng(kh.coords), 2);
    }

    _renderLegend() {
        // Legend removed — gearset colors are shown in the config panel
        if (this._legendEl) {
            this._legendEl.remove();
            this._legendEl = null;
        }
    }

    _renderFocusOverlay() {
        if (this._focusOverlayEl) return;
        const el = document.createElement('div');
        el.className = 'travel-focus-overlay';
        el.style.display = 'none';
        el.innerHTML = `
            <span class="travel-focus-swatch"></span>
            <span class="travel-focus-name"></span>
            <button class="travel-focus-exit-btn">Exit Focus</button>`;
        el.querySelector('.travel-focus-exit-btn').addEventListener('click', () => this.exitFocusMode());
        this.element.appendChild(el);
        this._focusOverlayEl = el;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Update route colors and step labels from a status map.
     * @param {{ [routeId]: { status: string, color: string, steps: number|null } }} statusMap
     */
    updateRouteStatuses(statusMap) {
        // Merge into existing status map (don't replace — other slots' statuses must persist)
        const newCount = Object.keys(statusMap).length;
        console.log(`[TravelMap.updateRouteStatuses] Merging ${newCount} routes into statusMap (existing: ${Object.keys(this.routeStatusMap).length})`);
        for (const [routeId, info] of Object.entries(statusMap)) {
            this.routeStatusMap[routeId] = info;
        }
        const colorUpdates = {};
        for (const [routeId, info] of Object.entries(statusMap)) {
            // Store the gearset color on the status for unmet diamond fill
            if (info.color) {
                if (!this.routeStatusMap[routeId]) this.routeStatusMap[routeId] = {};
                this.routeStatusMap[routeId].color = info.color;
            }

            const color = info.status === 'assigned_met' ? info.color
                : info.status === 'assigned_unmet' ? STATUS_COLORS.assigned_unmet
                    : STATUS_COLORS.unassigned;
            colorUpdates[routeId] = color;

            // Update tooltip
            const layers = this.routeLayers[routeId];
            if (layers && info.steps != null) {
                const reqs = this._getRouteReqs(routeId);
                const gearsetName = this._getGearsetNameForRoute(routeId);
                const assignedLine = gearsetName ? `<br><span style="color:#aaa">${gearsetName}</span>` : '';
                layers.fill.setTooltipContent(
                    `<strong>${this._getRouteName(routeId)}</strong><br>${info.steps} steps${assignedLine}${reqs}`
                );
            }
        }
        this.setRouteColors(colorUpdates);
    }

    /**
     * Register RouteGearsets for legend and focus mode.
     * @param {{ id: string, name: string, color: string, routeIds: string[] }[]} gearsets
     */
    updateRouteGearsets(gearsets) {
        this.routeGearsets = {};
        for (const gs of gearsets) {
            this.routeGearsets[gs.id] = gs;
        }
        this._renderLegend();
    }

    /**
     * Clear route statuses and reset to default circles with given color.
     * Used by clear/reset to remove diamond state.
     * @param {Object} colorMap - { routeId: hexColor }
     */
    clearRouteStatuses(colorMap) {
        for (const routeId of Object.keys(colorMap)) {
            delete this.routeStatusMap[routeId];
        }
        this.setRouteColors(colorMap);
    }

    /**
     * Set the fill color for specific routes by ID.
     * @param {Object} colorMap - { routeId: hexColor, ... }
     */
    setRouteColors(colorMap) {
        for (const [routeId, color] of Object.entries(colorMap)) {
            const layers = this.routeLayers[routeId];
            if (!layers) continue;

            const statusInfo = this.routeStatusMap[routeId];

            const isUnmetColor = color === '#e05050' || color === STATUS_COLORS.assigned_unmet;
            const isUnassignedColor = color === '#555555' || color === STATUS_COLORS.unassigned;
            const isStatusColor = isUnmetColor || isUnassignedColor;

            // If a non-status color is set (faction color, gearset color):
            // - For unmet routes: update the stored gearset color (keep diamond state)
            // - For unassigned routes: clear status (route was cleared/reset)
            // - For met routes: update the stored color
            if (!isStatusColor && statusInfo) {
                if (statusInfo.status === 'unassigned') {
                    delete this.routeStatusMap[routeId];
                } else {
                    // Keep the status (met or unmet), just update the gearset color
                    statusInfo.color = color;
                }
            }

            const currentStatus = this.routeStatusMap[routeId];
            const isExplicitUnmet = currentStatus?.status === 'assigned_unmet';
            const wantDiamonds = isExplicitUnmet || isUnmetColor;

            if (wantDiamonds) {
                // Hide circle polylines
                layers.outer.setStyle({ opacity: 0 });
                layers.ring.setStyle({ opacity: 0 });
                layers.fill.setStyle({ opacity: 0 });

                // For unmet routes: use gearset color as diamond fill, red as ring border
                // For unassigned: gray fill, dark gray ring
                let diamondFill, ringColor;
                if (isExplicitUnmet || isUnmetColor) {
                    // Use the stored gearset color if available, otherwise the passed color
                    const gearsetColor = statusInfo?.color;
                    diamondFill = gearsetColor || color;
                    ringColor = '#e05050';
                } else {
                    diamondFill = '#555555';
                    ringColor = '#222';
                }

                layers._diamondFillColor = diamondFill;
                layers._diamondRingColor = ringColor;

                // Show diamonds
                if (layers.diamondGroup && !layers._diamondsVisible) {
                    layers.diamondGroup.addTo(this.map);
                    layers._diamondsVisible = true;
                }
                // Update diamond colors
                if (layers.diamondGroup) {
                    layers.diamondGroup.eachLayer(m => {
                        const el = m.getElement?.();
                        if (!el) return;
                        const inner = el.querySelector('.travel-diamond-inner');
                        if (inner) {
                            inner.style.setProperty('--diamond-fill', diamondFill);
                        }
                    });
                }
            } else {
                // Show circle polylines
                layers.outer.setStyle({ color: 'white', opacity: 1 });
                layers.ring.setStyle({ color: 'black', opacity: 1 });
                layers.fill.setStyle({ color, opacity: 1 });
                // Hide diamonds
                if (layers.diamondGroup && layers._diamondsVisible) {
                    layers.diamondGroup.remove();
                    layers._diamondsVisible = false;
                }
            }
        }
    }

    /**
     * Pan the map to center on a route without changing zoom.
     * @param {string} routeId
     */
    panToRoute(routeId) {
        const layers = this.routeLayers[routeId];
        if (!layers || !layers.fill) return;
        const center = layers.fill.getCenter();
        if (center && this.map) {
            this.map.panTo(center);
        }
    }

    /**
     * Enter focus mode: dim all routes except those in the given gearset.
     * @param {string} gearsetId
     */
    enterFocusMode(gearsetId) {
        const gs = this.routeGearsets[gearsetId];
        if (!gs) return;

        this.focusedGearsetId = gearsetId;
        const focusedIds = new Set(gs.routeIds || []);

        for (const [routeId, layers] of Object.entries(this.routeLayers)) {
            const dim = !focusedIds.has(routeId);
            const opacity = dim ? 0.08 : 1;
            layers.outer.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            layers.ring.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            layers.fill.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            // Dim diamond markers
            if (layers.diamondGroup) {
                layers.diamondGroup.eachLayer(m => {
                    const el = m.getElement?.();
                    if (el) el.style.opacity = String(opacity);
                });
            }
        }

        // Dim locations not connected to focused routes
        this._setLocationDimming(this._getLocationsForRoutes(gs.routeIds || []));

        // Fit bounds to focused routes
        const pts = [];
        for (const routeId of gs.routeIds || []) {
            const route = this.routes.find(r => r.id === routeId);
            if (route) pts.push(...route.pathpoints.map(p => toLng(p)));
        }
        if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });

        // Re-apply diamond/location dimming after map finishes panning
        const gsRouteIds = gs.routeIds || [];
        this.map.once('moveend', () => {
            if (this.focusedGearsetId !== gearsetId) return;
            const focusSet = new Set(gsRouteIds);
            for (const [routeId, layers] of Object.entries(this.routeLayers)) {
                if (!layers.diamondGroup) continue;
                const dim = !focusSet.has(routeId);
                layers.diamondGroup.eachLayer(m => {
                    const el = m.getElement?.();
                    if (el) el.style.opacity = dim ? '0.08' : '1';
                });
            }
            this._setLocationDimming(this._getLocationsForRoutes(gsRouteIds));
            // Some markers may not have DOM elements yet after pan — retry after delays
            setTimeout(() => {
                if (this.focusedGearsetId !== gearsetId) return;
                this._setLocationDimming(this._getLocationsForRoutes(gsRouteIds));
            }, 300);
            setTimeout(() => {
                if (this.focusedGearsetId !== gearsetId) return;
                this._setLocationDimming(this._getLocationsForRoutes(gsRouteIds));
            }, 800);
            setTimeout(() => {
                if (this.focusedGearsetId !== gearsetId) return;
                this._setLocationDimming(this._getLocationsForRoutes(gsRouteIds));
            }, 2000);
        });

        // Show mobile overlay
        if (this._focusOverlayEl) {
            this._focusOverlayEl.querySelector('.travel-focus-swatch').style.background = gs.color;
            this._focusOverlayEl.querySelector('.travel-focus-name').textContent = gs.name;
            this._focusOverlayEl.style.display = 'flex';
        }
    }

    /**
     * Exit focus mode: restore all route opacities.
     */
    exitFocusMode() {
        this.focusedGearsetId = null;
        this._lastFocusedRouteIds = null;

        for (const [routeId, layers] of Object.entries(this.routeLayers)) {
            if (this._hiddenRouteIds.has(routeId)) {
                // Keep removed from map (disabled region — fully non-interactive)
                if (this.map.hasLayer(layers.outer)) layers.outer.remove();
                if (this.map.hasLayer(layers.ring)) layers.ring.remove();
                if (this.map.hasLayer(layers.fill)) layers.fill.remove();
                if (layers.diamondGroup && this.map.hasLayer(layers.diamondGroup)) layers.diamondGroup.remove();
                continue;
            }
            // Restore polylines
            const polyOpacity = layers._diamondsVisible ? 0 : 1;
            layers.outer.setStyle({ opacity: polyOpacity });
            layers.ring.setStyle({ opacity: polyOpacity });
            layers.fill.setStyle({ opacity: polyOpacity });
            if (!this.map.hasLayer(layers.outer)) layers.outer.addTo(this.map);
            if (!this.map.hasLayer(layers.ring)) layers.ring.addTo(this.map);
            if (!this.map.hasLayer(layers.fill)) layers.fill.addTo(this.map);
            if (layers.diamondGroup) {
                layers.diamondGroup.eachLayer(m => {
                    const el = m.getElement?.();
                    if (el) el.style.opacity = '1';
                });
            }
        }

        if (this._focusOverlayEl) this._focusOverlayEl.style.display = 'none';

        // Restore all location icons/labels
        this._setLocationDimming(null);
        // Re-remove locations for disabled regions (only if ALL routes through them are hidden)
        for (const rid of this._hiddenRouteIds) {
            const locs = this._getLocationsForRoutes([rid]);
            for (const [name, locLayers] of Object.entries(this.locationLayers)) {
                if (!locs.has(name)) continue;
                const allRoutesForLoc = this._getRouteIdsForLocation(name);
                const allHidden = allRoutesForLoc.every(r => this._hiddenRouteIds.has(r));
                if (allHidden) {
                    if (this.map.hasLayer(locLayers.icon)) locLayers.icon.remove();
                    if (this.map.hasLayer(locLayers.label)) locLayers.label.remove();
                }
            }
        }
    }

    /**
     * Focus on specific routes by ID — dims everything else.
     * Simpler than enterFocusMode which requires pre-registered gearsets.
     * @param {string[]} routeIds
     * @param {string} color - Hex color for the overlay swatch
     * @param {string} name - Display name for the overlay
     */
    focusRoutes(routeIds, color, name) {
        if (!routeIds || !routeIds.length) return;

        this.focusedGearsetId = '__custom__';
        const focusedIds = new Set(routeIds);
        this._lastFocusedRouteIds = focusedIds;

        for (const [routeId, layers] of Object.entries(this.routeLayers)) {
            const dim = !focusedIds.has(routeId);
            const opacity = dim ? 0.08 : 1;
            // Dim polylines (circles)
            layers.outer.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            layers.ring.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            layers.fill.setStyle({ opacity: dim ? 0.08 : (layers._diamondsVisible ? 0 : 1) });
            // Dim diamond markers
            if (layers.diamondGroup) {
                layers.diamondGroup.eachLayer(m => {
                    const el = m.getElement?.();
                    if (el) el.style.opacity = String(opacity);
                });
            }
        }

        // Dim locations not connected to focused routes
        this._setLocationDimming(this._getLocationsForRoutes(routeIds));

        // Fit bounds
        const pts = [];
        for (const routeId of routeIds) {
            const route = this.routes.find(r => r.id === routeId);
            if (route) pts.push(...route.pathpoints.map(p => toLng(p)));
        }
        if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });

        // Re-apply diamond/location dimming after map finishes panning
        // (Leaflet markers may not have DOM elements until they're in the viewport)
        this.map.once('moveend', () => {
            if (this.focusedGearsetId !== '__custom__') return;
            for (const [routeId, layers] of Object.entries(this.routeLayers)) {
                if (!layers.diamondGroup) continue;
                const dim = !focusedIds.has(routeId);
                layers.diamondGroup.eachLayer(m => {
                    const el = m.getElement?.();
                    if (el) el.style.opacity = dim ? '0.08' : '1';
                });
            }
            this._setLocationDimming(this._getLocationsForRoutes(routeIds));
            // Some markers may not have DOM elements yet after pan — retry after delays
            setTimeout(() => {
                if (this.focusedGearsetId !== '__custom__') return;
                this._setLocationDimming(this._getLocationsForRoutes(routeIds));
            }, 300);
            setTimeout(() => {
                if (this.focusedGearsetId !== '__custom__') return;
                this._setLocationDimming(this._getLocationsForRoutes(routeIds));
            }, 800);
        });

        // Show overlay
        if (this._focusOverlayEl) {
            this._focusOverlayEl.querySelector('.travel-focus-swatch').style.background = color || '#888';
            this._focusOverlayEl.querySelector('.travel-focus-name').textContent = name || '';
            this._focusOverlayEl.style.display = 'flex';
        }
    }

    /**
     * Show or hide specific routes and their associated location icons.
     * Used when a region is enabled/disabled.
     * @param {string[]} routeIds - Route IDs to show/hide
     * @param {boolean} visible - True to show, false to hide
     */
    setRouteVisibility(routeIds, visible) {
        // Track hidden routes so focus mode exit can restore correctly
        for (const rid of routeIds) {
            if (visible) this._hiddenRouteIds.delete(rid);
            else this._hiddenRouteIds.add(rid);
        }

        const routeSet = new Set(routeIds);

        for (const [routeId, layers] of Object.entries(this.routeLayers)) {
            if (!routeSet.has(routeId)) continue;
            if (visible) {
                // Re-add to map (restore interactivity)
                if (!this.map.hasLayer(layers.outer)) layers.outer.addTo(this.map);
                if (!this.map.hasLayer(layers.ring)) layers.ring.addTo(this.map);
                if (!this.map.hasLayer(layers.fill)) layers.fill.addTo(this.map);
                if (layers._diamondsVisible && layers.diamondGroup && !this.map.hasLayer(layers.diamondGroup)) {
                    layers.diamondGroup.addTo(this.map);
                }
            } else {
                // Remove from map (fully non-interactive)
                if (this.map.hasLayer(layers.outer)) layers.outer.remove();
                if (this.map.hasLayer(layers.ring)) layers.ring.remove();
                if (this.map.hasLayer(layers.fill)) layers.fill.remove();
                if (layers.diamondGroup && this.map.hasLayer(layers.diamondGroup)) {
                    layers.diamondGroup.remove();
                }
            }
        }

        // Hide/show location markers for locations connected to these routes
        const locationsForRoutes = this._getLocationsForRoutes(routeIds);
        for (const [name, locLayers] of Object.entries(this.locationLayers)) {
            if (!locationsForRoutes.has(name)) continue;
            if (visible) {
                // Restore if at least one route through this location is now visible
                if (!this.map.hasLayer(locLayers.icon)) locLayers.icon.addTo(this.map);
                if (!this.map.hasLayer(locLayers.label)) locLayers.label.addTo(this.map);
            } else {
                // Only hide if ALL routes through this location are now hidden
                const allRoutesForLoc = this._getRouteIdsForLocation(name);
                const allHidden = allRoutesForLoc.every(rid => this._hiddenRouteIds.has(rid));
                if (allHidden) {
                    if (this.map.hasLayer(locLayers.icon)) locLayers.icon.remove();
                    if (this.map.hasLayer(locLayers.label)) locLayers.label.remove();
                }
            }
        }
    }

    /**
     * Call after the map container is resized (e.g. after Divider drag).
     */
    invalidateSize(options = {}) {
        if (this.map) this.map.invalidateSize(options);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    _onRouteClick(route) {
        const gearsetName = this._getGearsetNameForRoute(route.id);
        // Open tooltip
        const layers = this.routeLayers[route.id];
        if (layers) {
            layers.fill.openTooltip();
        }
        // Notify parent to scroll config panel to this route
        if (this.onRouteClick) {
            this.onRouteClick(route.id, route.faction);
        }
    }

    _getRouteName(routeId) {
        const route = this.routes.find(r => r.id === routeId);
        return route ? route.name : routeId;
    }

    /** Get the set of location names that are endpoints of the given routes. */
    _getLocationsForRoutes(routeIds) {
        const names = new Set();
        for (const rid of routeIds) {
            const route = this.routes.find(r => r.id === rid);
            if (!route || !route.name) continue;
            // Route names: "Location A to Location B"
            const parts = route.name.split(' to ');
            if (parts.length === 2) {
                names.add(parts[0].trim());
                names.add(parts[1].trim());
            }
        }
        return names;
    }

    /** Get all route IDs that have the given location as an endpoint. */
    _getRouteIdsForLocation(locationName) {
        return this.routes
            .filter(r => {
                if (!r.name) return false;
                const parts = r.name.split(' to ');
                return parts.length === 2 &&
                    (parts[0].trim() === locationName || parts[1].trim() === locationName);
            })
            .map(r => r.id);
    }

    /** Dim or restore location icons/labels based on a set of active location names. */
    _setLocationDimming(activeNames) {
        for (const [name, layers] of Object.entries(this.locationLayers)) {
            const dim = activeNames && !activeNames.has(name);
            const opacity = dim ? 0.08 : 1;
            const iconEl = layers.icon.getElement?.();
            const labelEl = layers.label.getElement?.();
            if (iconEl) iconEl.style.opacity = String(opacity);
            if (labelEl) labelEl.style.opacity = String(opacity);
        }
    }

    _getRouteReqs(routeId) {
        const route = this.routes.find(r => r.id === routeId);
        if (!route || !route.terrainModifiers || !route.terrainModifiers.length) return '';
        return '<br><em>' + route.terrainModifiers.join('<br>') + '</em>';
    }

    _getGearsetNameForRoute(routeId) {
        for (const gs of Object.values(this.routeGearsets)) {
            if ((gs.routeIds || []).includes(routeId)) return gs.name;
        }
        return null;
    }
}
