/**
 * TravelInfoSection Component
 * 
 * Displays travel route information when "Traveling" activity is selected.
 * 
 * Features:
 * - Two LocationDropdown instances (Start, End)
 * - Route fetching via GET /api/travel/route
 * - Overall stats display (total steps min-max ~avg, WE, DA)
 * - Per-segment display with stats and requirement bubbles
 * - Recalculates on gearset change
 * 
 * Requirements: 3.1, 4.2, 5.1-5.5, 6.1-6.4, 11.1, 11.3, 11.4
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import LocationDropdown from './location-dropdown.js';

import { formatFixed } from '../utils/number-format.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';

class TravelInfoSection extends Component {
    /**
     * Create a travel info section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {Function} props.onRouteChange - Callback when route changes
     */
    constructor(element, props = {}) {
        super(element, props);

        this.onRouteChangeCallback = props.onRouteChange || (() => { });

        // State - restore from session if available
        this.startLocation = store.state.column3?.travelStart ?? null;
        this.endLocation = store.state.column3?.travelEnd ?? null;
        this.routeData = null;
        this.statsData = null;
        this.isLoadingRoute = false;
        this.isLoadingStats = false;
        this.routeError = null;

        // Child components
        this.startDropdown = null;
        this.endDropdown = null;

        // Subscribe to gearset changes
        this.subscribe('gearsets', () => this.onGearsetChange());

        // Subscribe to travelStart/travelEnd changes so session restore updates the dropdowns
        this.subscribe('column3.travelStart', () => {
            const newStart = store.state.column3?.travelStart ?? null;
            if (newStart !== this.startLocation) {
                this.startLocation = newStart;
                if (this.startDropdown) {
                    this.startDropdown.setSelectedLocation(newStart);
                }
                this.fetchRoute();
            }
        });
        this.subscribe('column3.travelEnd', () => {
            const newEnd = store.state.column3?.travelEnd ?? null;
            if (newEnd !== this.endLocation) {
                this.endLocation = newEnd;
                if (this.endDropdown) {
                    this.endDropdown.setSelectedLocation(newEnd);
                }
                this.fetchRoute();
            }
        });

        // Initial render
        this.render();

        // If locations were restored from session, fetch the route
        if (this.startLocation && this.endLocation) {
            this.fetchRoute();
        }
    }

    /**
     * Handle start location change
     * @param {Object|null} location - Selected location object from LocationDropdown
     */
    onStartLocationChange(location) {
        const locationId = location ? location.id : null;
        // [TRAVEL-DIAG] Log the dropdown→state transition. If the optimizer
        // later sees a different start than what's logged here, the bug is
        // between the dropdown and optimizeTravel().
        console.log('[TRAVEL-DIAG][onStartLocationChange] dropdown selected location =',
            location, 'storing locationId =', locationId);
        this.startLocation = locationId;
        store.state.column3.travelStart = locationId;
        store._saveColumn3Selection();
        this.fetchRoute();
    }

    /**
     * Handle end location change
     * @param {Object|null} location - Selected location object from LocationDropdown
     */
    onEndLocationChange(location) {
        const locationId = location ? location.id : null;
        console.log('[TRAVEL-DIAG][onEndLocationChange] dropdown selected location =',
            location, 'storing locationId =', locationId);
        this.endLocation = locationId;
        store.state.column3.travelEnd = locationId;
        store._saveColumn3Selection();
        this.fetchRoute();
    }

    /**
     * Handle gearset change - recalculate stats
     */
    onGearsetChange() {
        if (this.routeData && this.routeData.segments) {
            this.fetchStats();
        }
    }

    /**
     * Encode current gearset to export string for API calls
     * @returns {string} Base64-encoded gzip-compressed gearset JSON
     */
    encodeCurrentGearset() {
        const gearset = store.state.gearsets?.current || {};

        const items = [];
        const slotTypeMap = {
            'head': 'head', 'cape': 'cape', 'back': 'back',
            'chest': 'chest', 'primary': 'primary', 'secondary': 'secondary',
            'hands': 'hands', 'legs': 'legs', 'neck': 'neck', 'feet': 'feet'
        };

        // Helper: get the rarity code for gearset export encoding.
        // Crafted items have quality="Good" (display name) and rarity="uncommon" (code).
        // The backend expects the rarity code (uncommon, rare, etc.), not the display name.
        const getExportQuality = (item) => {
            if (!item) return 'common';
            return item.rarity || 'common';
        };

        // Gear slots
        for (const [slotName, slotType] of Object.entries(slotTypeMap)) {
            const item = gearset[slotName];
            items.push({
                type: slotType, index: 0,
                item: item && item.uuid
                    ? JSON.stringify({ id: item.uuid, quality: getExportQuality(item), tag: null })
                    : 'null',
                errors: []
            });
        }

        // Ring slots
        for (let i = 1; i <= 2; i++) {
            const item = gearset[`ring${i}`];
            items.push({
                type: 'ring', index: i - 1,
                item: item && item.uuid
                    ? JSON.stringify({ id: item.uuid, quality: getExportQuality(item), tag: null })
                    : 'null',
                errors: []
            });
        }

        // Tool slots
        for (let i = 0; i < 6; i++) {
            const item = gearset[`tool${i}`];
            items.push({
                type: 'tool', index: i,
                item: item && item.uuid
                    ? JSON.stringify({ id: item.uuid, quality: getExportQuality(item), tag: null })
                    : 'null',
                errors: []
            });
        }

        // Pet slot.
        // The backend resolves pets by SPECIES + LEVEL (PETS_BY_NAME.get_level),
        // not by uuid, and the bonus is level-scoped (e.g. Reindeer agility WE is
        // 1/2/4% at L1/L2/L3). Resolve level the same way Combined Stats does
        // (user_overrides.items[petId].level -> store.items[petId].level ->
        // slot.level) so the two views never diverge.
        const pet = gearset['pet'];
        let petItem = 'null';
        if (pet && (pet.species || pet.itemId || pet.id)) {
            const species = String(pet.species || pet.itemId || pet.id || '');
            const petId = pet.itemId || pet.id || species.toLowerCase();
            const ov = (store.state.ui?.user_overrides?.items?.[petId]) || {};
            const base = (store.state.items?.[petId]) || {};
            const level = ov.level != null ? ov.level
                : (base.level != null ? base.level
                : (pet.level != null ? pet.level : 0));
            const useAbility = pet.useAbility != null ? pet.useAbility : !!ov.useAbility;
            petItem = JSON.stringify({
                id: species, species: species, level: level,
                use_ability: !!useAbility, quality: getExportQuality(pet), tag: null,
            });
        }
        items.push({ type: 'pet', index: 0, item: petItem, errors: [] });

        // Consumable (food) slot. Previously omitted entirely, so food WE (e.g.
        // Bagel +5% WE) was invisible to the Travel info section. The backend
        // resolves via Consumable.by_export_name(id) and handles the _fine variant.
        const cons = gearset['consumable'];
        let consItem = 'null';
        if (cons && (cons.itemId || cons.id || cons.name)) {
            let consId = String(cons.itemId || cons.id || cons.name || '');
            let consFine = !!cons.is_fine || consId.toLowerCase().endsWith('_fine');
            consId = consId.replace(/_fine$/i, '');
            consItem = JSON.stringify({ id: consId, is_fine: consFine });
        }
        items.push({ type: 'consumable', index: 0, item: consItem, errors: [] });

        const jsonStr = JSON.stringify({ items });
        const compressed = window.pako.gzip(jsonStr);
        let binary = '';
        const bytes = new Uint8Array(compressed);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Fetch route between start and end locations
     */
    async fetchRoute() {
        // Clear previous data
        this.routeData = null;
        this.statsData = null;
        this.routeError = null;

        // [TRAVEL-DIAG] Log every fetchRoute call with the start/end about to
        // be requested. Also captures the case where startLocation/endLocation
        // are null (e.g. fresh page load before selection).
        console.log('[TRAVEL-DIAG][fetchRoute] startLocation =', this.startLocation,
            'endLocation =', this.endLocation);

        if (!this.startLocation || !this.endLocation) {
            this.renderContent();
            this.onRouteChangeCallback(null);
            return;
        }

        if (this.startLocation === this.endLocation) {
            this.routeError = 'Start and end locations must be different';
            this.renderContent();
            this.onRouteChangeCallback(null);
            return;
        }

        this.isLoadingRoute = true;
        this.renderContent();

        try {
            const response = await $.get(`/api/travel/route?start=${encodeURIComponent(this.startLocation)}&end=${encodeURIComponent(this.endLocation)}`);

            if (response.success) {
                this.routeData = response;
                // [TRAVEL-DIAG] Log the segments Dijkstra returned. If the
                // user picks A→B and segments include unexpected legs (e.g.
                // a Halfling Campgrounds light-source segment when going
                // somewhere else), the bug is in the route finder.
                try {
                    const segs = response.segments || [];
                    console.log('[TRAVEL-DIAG][fetchRoute] backend returned',
                        segs.length, 'segments, total_distance =', response.total_distance);
                    for (const s of segs) {
                        const reqs = s.requirements?.keyword_counts || s.requirements || {};
                        console.log('[TRAVEL-DIAG][fetchRoute]   ',
                            (s.start_name || s.start), '→', (s.end_name || s.end),
                            'dist =', s.distance, 'reqs =', reqs);
                    }
                } catch (e) {
                    console.warn('[TRAVEL-DIAG][fetchRoute] segment log failed:', e);
                }
                this.onRouteChangeCallback(response);
                // Fetch stats for this route
                await this.fetchStats();
            } else {
                this.routeError = response.error || 'Failed to find route';
                this.onRouteChangeCallback(null);
            }
        } catch (error) {
            if (error.responseJSON) {
                this.routeError = error.responseJSON.error || 'No route available between these locations';
            } else {
                this.routeError = 'No route available between these locations';
            }
            this.onRouteChangeCallback(null);
        } finally {
            this.isLoadingRoute = false;
            this.renderContent();
        }
    }

    /**
     * Fetch stats for current route and gearset
     */
    async fetchStats() {
        if (!this.routeData || !this.routeData.segments) {
            return;
        }

        this.isLoadingStats = true;
        this.renderContent();

        try {
            const gearsetExport = this.encodeCurrentGearset();

            const response = await $.ajax({
                url: '/api/travel/stats',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    segments: this.routeData.segments,
                    gearset_export: gearsetExport
                })
            });

            if (response.success) {
                this.statsData = response;
            }
        } catch (error) {
            console.error('Failed to fetch travel stats:', error);
        } finally {
            this.isLoadingStats = false;
            this.renderContent();
            // Publish per-segment stats (incl. drops) so the DROPS section can
            // render travel drops in the same card activities/recipes use.
            this._publishTravelStats();
        }
    }

    /**
     * Publish the current travel stats to the store so DropsSection (a separate
     * column-3 component) can render per-segment drops in the standard DROPS
     * card. Passing null clears it (e.g. no route).
     */
    _publishTravelStats() {
        if (!store.state.column3) store.state.column3 = {};
        store.state.column3.travelStatsData = this.statsData || null;
        store._notifySubscribers('column3.travelStats');
    }

    /**
     * Render overall stats section
     * Requirements: 5.1, 5.2, 5.3, 5.4, 11.4
     * @returns {string} HTML
     */
    renderStatsSection() {
        if (!this.statsData) {
            return '';
        }

        const total = this.statsData.total;

        // WE display: offset by 100, show range if min != max
        const weMin = formatFixed((total.work_efficiency_min + 100), 1);
        const weMax = formatFixed((total.work_efficiency_max + 100), 1);
        const weDisplay = weMin === weMax ? `${weMin}%` : `${weMin} - ${weMax}%`;

        // DA display: show range if min != max
        const daMin = formatFixed(total.double_action_min, 1);
        const daMax = formatFixed(total.double_action_max, 1);
        const daDisplay = daMin === daMax ? `${daMin}%` : `${daMin} - ${daMax}%`;

        // Steps display: depends on whether any segment has DA > 0
        // If all segments have DA=0: no variance, show single value
        // If all segments have DA=100%: always min, show single value
        // Otherwise: show MIN - MAX (~Expected)
        const allZeroDA = this.statsData.segments.every(s => s.double_action === 0);
        const allMaxDA = this.statsData.segments.every(s => s.double_action >= 100);
        let stepsDisplay;
        if (allZeroDA) {
            // No DA = no variance, expected equals max
            stepsDisplay = `${total.steps_max} (~${total.steps_max})`;
        } else if (allMaxDA) {
            // 100% DA = always min
            stepsDisplay = `${total.steps_min} (~${total.steps_min})`;
        } else {
            stepsDisplay = `${total.steps_min} - ${total.steps_max} (~${total.steps_avg})`;
        }

        // Aggregate requirements across all segments
        let requirementsHtml = '';
        if (this.statsData.segments) {
            const aggregated = {};
            for (const seg of this.statsData.segments) {
                const kf = seg.keyword_fulfillment || {};
                for (const [keyword, info] of Object.entries(kf)) {
                    if (!aggregated[keyword]) {
                        aggregated[keyword] = { required: 0, current: info.current, met: true };
                    }
                    aggregated[keyword].required = Math.max(aggregated[keyword].required, info.required);
                    if (!info.met) aggregated[keyword].met = false;
                }
            }
            if (Object.keys(aggregated).length > 0) {
                requirementsHtml = '<div class="requirements-grid" style="margin-bottom: var(--spacing-sm);">';
                for (const [keyword, info] of Object.entries(aggregated)) {
                    const borderClass = info.met ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                    const keywordId = keyword.replace(/ /g, '_').replace(/'/g, '');
                    const keywordIcon = `/assets/icons/keywords/${keywordId}.svg`;
                    requirementsHtml += `
                        <div class="requirement-item ${borderClass}">
                            <span class="requirement-value">${info.required}</span>
                            <img src="${keywordIcon}" alt="${keyword}" class="requirement-icon" title="${keyword}" />
                            <span class="requirement-label">${keyword}</span>
                        </div>
                    `;
                }
                requirementsHtml += '</div>';
            }
        }

        return `
            <div class="activity-section">
                <div class="section-header">TOTAL STEPS (MIN - MAX STEPS, ~AVERAGE)</div>
                ${requirementsHtml}
                <div class="stats-grid">
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Total Steps (min - max, ~expected)" />
                        <span class="stat-value">${stepsDisplay}</span>
                    </div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/work_efficiency.svg" alt="WE" class="stat-icon" title="Work Efficiency (range)" />
                        <span class="stat-value">${weDisplay}</span>
                    </div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/double_action.svg" alt="DA" class="stat-icon" title="Double Action (range)" />
                        <span class="stat-value">${daDisplay}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render a single route segment bubble
     * Requirements: 6.1, 6.2, 6.3, 6.4, 11.1, 11.3
     * @param {Object} segment - Segment stats data
     * @returns {string} HTML
     */
    renderSegmentBubble(segment) {
        const weDisplay = formatFixed((segment.work_efficiency + 100), 1);
        const daDisplay = formatFixed(segment.double_action, 1);

        // Steps display: if DA=0, show single value; otherwise show ~expected
        let stepsDisplay;
        if (segment.double_action === 0) {
            stepsDisplay = `~${segment.steps_max}`;
        } else if (segment.double_action >= 100) {
            stepsDisplay = `~${segment.steps_min}`;
        } else {
            stepsDisplay = `~${segment.steps_avg}`;
        }

        // Location icons
        const startIcon = segment.start_icon
            ? `<img src="/assets/icons/locations/${segment.start_icon}" alt="" class="segment-location-icon" />`
            : '';
        const endIcon = segment.end_icon
            ? `<img src="/assets/icons/locations/${segment.end_icon}" alt="" class="segment-location-icon" />`
            : '';

        // Requirement bubbles
        let requirementsHtml = '';
        const keywordFulfillment = segment.keyword_fulfillment || {};
        if (Object.keys(keywordFulfillment).length > 0) {
            requirementsHtml = '<div class="requirements-grid" style="margin-top: var(--spacing-sm); margin-bottom: var(--spacing-sm);">';
            for (const [keyword, info] of Object.entries(keywordFulfillment)) {
                const borderClass = info.met ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                const keywordId = keyword.replace(/ /g, '_').replace(/'/g, '');
                const keywordIcon = `/assets/icons/keywords/${keywordId}.svg`;

                requirementsHtml += `
                    <div class="requirement-item ${borderClass}">
                        <span class="requirement-value">${info.required}</span>
                        <img src="${keywordIcon}" alt="${keyword}" class="requirement-icon" title="${keyword}" />
                        <span class="requirement-label">${keyword}</span>
                    </div>
                `;
            }
            requirementsHtml += '</div>';
        }

        return `
            <div class="travel-segment-bubble">
                <div class="segment-header">${startIcon}${segment.start_name} to ${endIcon}${segment.end_name}</div>
                ${requirementsHtml}
                <div class="stats-grid">
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Expected Steps" />
                        <span class="stat-value">${stepsDisplay}</span>
                    </div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/work_efficiency.svg" alt="WE" class="stat-icon" title="Work Efficiency" />
                        <span class="stat-value">${weDisplay}%</span>
                    </div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/double_action.svg" alt="DA" class="stat-icon" title="Double Action" />
                        <span class="stat-value">${daDisplay}%</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render all route segments
     * @returns {string} HTML
     */
    renderSegments() {
        if (!this.statsData || !this.statsData.segments) {
            return '';
        }

        let html = '<div class="activity-section"><div class="section-header">ROUTE SEGMENTS</div>';
        for (const segment of this.statsData.segments) {
            html += this.renderSegmentBubble(segment);
        }
        html += '</div>';
        return html;
    }

    /**
     * Render the content area (everything below the dropdowns)
     * Called on data changes without recreating dropdowns
     */
    renderContent() {
        const $content = this.$element.find('.travel-info-content');
        if (!$content.length) return;

        let html = '';

        if (this.isLoadingRoute) {
            html = '<div class="travel-loading">Finding route...</div>';
        } else if (this.routeError) {
            html = `<div class="travel-no-route">${this.routeError}</div>`;
        } else if (this.routeData) {
            if (this.isLoadingStats) {
                html = '<div class="travel-loading">Calculating stats...</div>';
            } else {
                html = this.renderStatsSection() + this.renderSegments();
            }
        }

        $content.html(html);
    }

    /**
     * Render the full component
     */
    render() {
        // Destroy old dropdowns
        if (this.startDropdown) {
            this.startDropdown.destroy();
            this.startDropdown = null;
        }
        if (this.endDropdown) {
            this.endDropdown.destroy();
            this.endDropdown = null;
        }

        const html = `
            <div class="activity-info-section travel-info" data-pin-id="travel-info">
                <div class="activity-info-header">
                    <span class="activity-info-title">TRAVELING</span>
                </div>
                <div class="activity-info-content" style="padding: var(--spacing-md);">
                    <div class="info-wiki-link-wrapper"><a href="https://wiki.walkscape.app/wiki/Agility${wikiDarkModeSuffix()}#Traveling" target="_blank" rel="noopener noreferrer" class="wiki-link info-wiki-link">Wiki</a></div>
                    <div class="travel-dropdowns">
                        <div id="travel-start-dropdown"></div>
                        <div id="travel-end-dropdown"></div>
                    </div>
                    <div class="travel-info-content"></div>
                </div>
            </div>
        `;

        this.$element.html(html);

        // Create dropdown instances
        this.startDropdown = new LocationDropdown(
            this.$element.find('#travel-start-dropdown'),
            {
                label: 'Start',
                onSelect: (id) => this.onStartLocationChange(id),
                selectedLocation: this.startLocation
            }
        );

        this.endDropdown = new LocationDropdown(
            this.$element.find('#travel-end-dropdown'),
            {
                label: 'End',
                onSelect: (id) => this.onEndLocationChange(id),
                selectedLocation: this.endLocation
            }
        );

        // Render content area
        this.renderContent();
    }

    /**
     * Get current route data (for optimize button)
     * @returns {Object|null} Route data with segments
     */
    getRouteData() {
        return this.routeData;
    }

    /**
     * Get start and end location IDs
     * @returns {Object} { start, end }
     */
    getLocations() {
        return {
            start: this.startLocation,
            end: this.endLocation
        };
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.startDropdown) {
            this.startDropdown.destroy();
        }
        if (this.endDropdown) {
            this.endDropdown.destroy();
        }
        // Clear published travel stats so the DROPS section stops showing
        // travel drops when the user switches off Traveling.
        this.statsData = null;
        this._publishTravelStats();
        super.destroy();
    }
}

export default TravelInfoSection;
