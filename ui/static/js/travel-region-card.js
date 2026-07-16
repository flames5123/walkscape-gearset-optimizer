import { showInfoPopover, wireInfoIcons } from './info-popover.js';
import { showGearsetPicker } from './travel-gearset-picker.js';
import { showImportGearsetModal } from './travel-import-gearset-modal.js';
import { LOCATION_CANONICAL_REGION } from './travel-config-panel.js';

import { formatFixed } from './utils/number-format.js';

/**
 * RegionCard - A UI card representing one game region.
 *
 * Displays the region name, faction icon, route count, enable checkbox,
 * Gearset_Mode selector, and Route_Gearset slots. Supports two-click
 * confirmation for Reset Region.
 *
 * Requirements: 3.1–3.8
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Patterns that indicate a gearset-equippable requirement (case-insensitive).
 *  Collectible/ability requirements (letter of passage, wilderness permit, etc.)
 *  are region-unlock prerequisites and should NOT split routes into groups. */
const GEARSET_REQUIREMENT_PATTERNS = [
    /diving gear/i,
    /skis equipped/i,
    /light source/i,
];

/** Build a short label from a list of requirement strings.
 *  e.g. ["Requires 2 uniquely equipped Light Source"] → "2 Light"
 *       ["Requires 3 diving gear equipped", "Requires Skis equipped"] → "3 Diving + Skis" */
function shortReqLabel(reqs) {
    if (!reqs || !reqs.length) return 'No Req';
    const parts = reqs.map(r => {
        let m;
        if ((m = r.match(/(\d+)\s+(?:uniquely\s+equipped\s+)?light source/i))) return `${m[1]} Light`;
        if (/light source/i.test(r)) return 'Light';
        if ((m = r.match(/(\d+)\s+(?:expert\s+|advanced\s+)?diving gear/i))) return `${m[1]} Diving`;
        if (/diving gear/i.test(r)) return 'Diving';
        if (/skis/i.test(r)) return 'Skis';
        return r.replace(/^requires\s+/i, '').substring(0, 20);
    });
    return parts.join(' + ');
}

function isGearsetRequirement(req) {
    return GEARSET_REQUIREMENT_PATTERNS.some(pat => pat.test(req));
}

/** Filter a terrainModifiers array to only gearset-equippable requirements. */
function filterGearsetRequirements(terrainModifiers) {
    return (terrainModifiers || []).filter(isGearsetRequirement);
}

const GEARSET_MODES = [
    { value: 'single', label: 'Single' },
    { value: 'multi', label: 'Multi', hasInfo: true, hasSlider: true },
    { value: 'requirements', label: 'Requirements', hasInfo: true },
    { value: 'advanced', label: 'Advanced' },
];

const MODE_INFO_TEXT = {
    single: 'One gearset optimized across all routes in this region. Best when routes have similar terrain and you want simplicity.',
    multi: 'The optimizer finds N gearsets that together minimize total steps across all routes in this region. Each gearset will show which routes it applies to after optimization. Use 2 for a simple long/short split.\n\nTip: We recommend setting the count to at least the number of requirement groups (shown in Requirements mode) to ensure terrain requirements are covered. But feel free to experiment!',
    requirements: 'Automatically groups routes by their terrain requirements (diving gear, skis, light sources, etc.). Routes with no requirements share one gearset, and each unique requirement set gets its own gearset.',
    advanced: 'Each route gets its own gearset slot. You can select multiple routes with the checkboxes and group them together — grouped routes share one optimized gearset. Useful for routes with the same terrain requirements.',
};

export { GEARSET_MODES };

// ============================================================================
// REGIONCARD CLASS
// ============================================================================

export default class RegionCard {
    /**
     * @param {HTMLElement} element
     * @param {Object} opts
     * @param {Object}   opts.region        - { id, name, factions, color }
     * @param {number}   opts.routeCount    - Number of routes in this region
     * @param {Array}    opts.routes        - Route objects for this region (from map data)
     * @param {Object}   opts.regionConfig  - Config for this region from Travel_Config_Store
     * @param {Function} opts.onConfigChange - (key, value) => void
     * @param {Function} opts.onOptimize     - (taskKey, payload) => void
     * @param {Array}    opts.exceptionRoutes - Exception routes for this region (when show_exception_routes is false)
     * @param {Object}   opts.exceptionsConfig - exceptions section of Travel_Config_Store
     * @param {Function} opts.onExceptionConfigChange - (routeId, key, value) => void
     */
    constructor(element, opts = {}) {
        this.el = typeof element === 'string' ? document.querySelector(element) : element;
        this.region = opts.region || {};
        this.routeCount = opts.routeCount || 0;
        this.routes = opts.routes || [];
        this.locationIcons = opts.locationIcons || {};
        this.regionConfig = opts.regionConfig || {};
        this.onConfigChange = opts.onConfigChange || (() => { });
        this.onOptimize = opts.onOptimize || (() => { });
        this.onRouteColorChange = opts.onRouteColorChange || (() => { });
        this.onPanToRoute = opts.onPanToRoute || (() => { });

        // Exception routes shown inline under this card (Req 6.3)
        // Only populated when show_exception_routes is false
        this.exceptionRoutes = opts.exceptionRoutes || [];
        this.exceptionsConfig = opts.exceptionsConfig || {};
        this.onExceptionConfigChange = opts.onExceptionConfigChange || (() => { });

        // Reset Region two-click state
        this._resetPending = false;
        this._resetTimer = null;

        // Collapse state (UI-only, not persisted) — collapsed by default
        this._collapsed = true;

        // Advanced mode grouping selection state (not persisted — UI-only)
        this._selectedSlots = new Set();
        this._expandedGroups = new Set();

        // Optimization loading state — tracks which slots are currently optimizing
        this._optimizingSlots = new Set();
        this._advancedSearchText = '';

        // Defaults
        if (this.regionConfig.enabled === undefined) {
            this.regionConfig.enabled = this.region.id === 'jarvonia';
        }
        if (!this.regionConfig.mode) {
            this.regionConfig.mode = 'single';
        }
        if (this.regionConfig.multi_count === undefined) {
            this.regionConfig.multi_count = 2;
        }

        this._render();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _render() {
        if (!this.el) return;

        const enabled = this.regionConfig.enabled;
        const mode = this.regionConfig.mode || 'single';
        const dimClass = !enabled ? 'travel-region-card--dimmed' : '';
        const collapsedClass = this._collapsed ? 'travel-region-card--collapsed' : '';

        this.el.className = `travel-region-card ${dimClass} ${collapsedClass}`;
        this.el.innerHTML = `
            ${this._renderHeader()}
            <div class="travel-region-card-body" ${(!enabled || this._collapsed) ? 'style="display:none;"' : ''}>
                ${this._renderRegionWarnings()}
                ${this._renderModeSelector()}
                ${this._renderOptimizeAllButton()}
                ${this._renderGearsetSlots()}
                ${this._renderAdvancedEditButton()}
                ${this._renderInlineExceptionRoutes()}
                ${this._renderResetButton()}
            </div>
        `;

        this._attachEvents();
    }

    _renderHeader() {
        const enabled = this.regionConfig.enabled;
        const mode = this.regionConfig.mode || 'single';
        const factionId = this.region.id;
        const iconUrl = `/assets/icons/factions/${factionId}.svg`;
        // Arrow should reflect actual body visibility: collapsed OR disabled
        const bodyHidden = this._collapsed || !enabled;
        const chevronClass = bodyHidden ? 'expand-arrow' : 'expand-arrow expanded';
        const modeLabel = (() => {
            const base = GEARSET_MODES.find(m => m.value === mode)?.label || mode;
            if (mode === 'multi') return `${base} (${this.regionConfig.multi_count || 2})`;
            return base;
        })();

        return `
            <div class="travel-region-card-header">
                <label class="travel-region-enable" onclick="event.stopPropagation()">
                    <input type="checkbox" class="travel-region-enable-cb"
                           ${enabled ? 'checked' : ''} />
                </label>
                <img src="${iconUrl}" alt="${this.region.name}"
                     class="travel-region-icon"
                     onerror="this.style.display='none'" />
                <span class="travel-region-name travel-region-name--clickable">${this.region.name}</span>
                <span class="travel-region-mode-label">${modeLabel}</span>
                <span class="travel-region-route-count">${this.routeCount} routes</span>
                <span class="${chevronClass}">▼</span>
            </div>
        `;
    }

    /**
     * Render region-level warnings (e.g., Navigate Desert for Wrentmark).
     * Req 9.5: When a route requires Navigate Desert and the user's character
     * does not have that ability, show a warning on the Wrentmark RegionCard.
     * @private
     */
    _renderRegionWarnings() {
        const warnings = this.regionConfig._region_warnings || [];
        if (!warnings.length) return '';

        const items = warnings.map(w => {
            const icon = this._getWarningIcon(w);
            return `<div class="travel-gearset-warning-item">${icon} ${this._escapeHtml(w)}</div>`;
        }).join('');

        return `<div class="travel-region-warnings">${items}</div>`;
    }

    _renderModeSelector() {
        const mode = this.regionConfig.mode || 'single';
        const multiCount = this.regionConfig.multi_count || 2;
        const maxMulti = Math.max(2, this.routeCount);

        let optionsHtml = '';
        for (const m of GEARSET_MODES) {
            const selected = m.value === mode ? 'selected' : '';
            optionsHtml += `<option value="${m.value}" ${selected}>${m.label}</option>`;
        }

        // General mode overview (i) — always shown next to "Mode:" label
        const modeOverview =
            '• Single — One gearset for all routes in the region.\n\n' +
            '• Multi — N gearsets (you pick how many) split by route distance. Use 2 for a long/short split.\n\n' +
            '• Requirements — Auto-groups routes by terrain requirements (diving, skis, etc.).\n\n' +
            '• Advanced — One gearset per route, with manual grouping.';
        const modeInfoIcon = `<span class="travel-info-icon" data-info="${this._escapeHtml(modeOverview)}" role="button" tabindex="0" aria-label="Mode info">ⓘ</span>`;

        // Mode-specific info icon (shown after the dropdown for modes with extra detail)
        const hasDetail = MODE_INFO_TEXT[mode];
        const detailIcon = hasDetail
            ? `<span class="travel-info-icon" data-info="${this._escapeHtml(MODE_INFO_TEXT[mode])}" role="button" tabindex="0" aria-label="Info">ⓘ</span>`
            : '';

        // Multi slider
        const showSlider = mode === 'multi';
        const multiMaxNote = this.regionConfig._multi_max_note || null;
        const sliderHtml = showSlider ? `
            <div class="travel-multi-slider">
                <label class="travel-multi-slider-label">
                    Number of Gear Sets: <strong class="travel-multi-count-display">${multiCount}</strong>
                </label>
                <input type="range" class="travel-multi-slider-input"
                       min="2" max="${maxMulti}" value="${multiCount}" />
                ${multiMaxNote ? `<div class="travel-multi-max-note">${this._escapeHtml(multiMaxNote)}</div>` : ''}
            </div>
        ` : '';

        // Advanced mode search bar
        const showSearch = mode === 'advanced';
        const searchHtml = showSearch ? `
            <div class="travel-advanced-search">
                <input type="text" class="travel-advanced-search-input"
                       placeholder="Search routes..." value="${this._advancedSearchText || ''}" />
            </div>
        ` : '';

        return `
            <div class="travel-mode-selector">
                <span class="travel-mode-label">Mode:</span>
                ${modeInfoIcon}
                <select class="travel-mode-select">${optionsHtml}</select>
                ${detailIcon}
                <button class="travel-region-header-reset-btn" title="Reset Region" onclick="event.stopPropagation()">↺</button>
            </div>
            ${sliderHtml}
            ${searchHtml}
        `;
    }

    _renderGearsetSlots() {
        const mode = this.regionConfig.mode || 'single';
        const count = this._getGearsetCount();

        if (count === 0) return '';

        // Breakpoint display for multi mode with 2 gearsets (Req 4.8)
        const breakpoint = this.regionConfig.breakpoint;
        const showBreakpoint = (mode === 'long_short' || mode === 'multi') && (count === 2) && breakpoint != null;
        const breakpointHtml = showBreakpoint
            ? `<div class="travel-breakpoint-display">Breakpoint: <strong>${breakpoint}</strong> steps <span class="travel-info-icon" data-info="Routes shorter than this use one gearset, routes longer use the other. The optimizer found this split minimizes total steps across all routes." role="button" tabindex="0" aria-label="Breakpoint info">ⓘ</span></div>`
            : '';

        const isAdvanced = mode === 'advanced';
        const isRequirements = mode === 'requirements';

        // "Advanced Edit" button for modes that produce groups (and single for removing routes)
        const showAdvancedEdit = (mode === 'single' || mode === 'long_short' || mode === 'multi' || mode === 'requirements');
        const advancedEditHtml = showAdvancedEdit
            ? `<div class="travel-advanced-edit-row"><button class="button travel-advanced-edit-btn" title="Switch to Advanced mode with current groups for fine-tuning">Advanced Edit ▸</button></div>`
            : '';

        let html = '<div class="travel-gearset-slots">';
        html += breakpointHtml;

        if (isAdvanced) {
            html += this._renderAdvancedSlots();
        } else if (isRequirements) {
            html += this._renderRequirementsSlots();
        } else {
            for (let i = 0; i < count; i++) {
                const slotKey = mode === 'single' ? 'single' : String(i + 1);
                const gearset = this.regionConfig.gearsets?.[slotKey] || {};

                // Check if this slot is currently optimizing
                const isOptimizing = this._optimizingSlots.has(slotKey)
                    || (mode !== 'single' && this._optimizingSlots.has('multi'));

                const name = isOptimizing
                    ? '<span class="travel-opt-spinner">⏳</span> Optimizing…'
                    : (gearset.name || `${this.region.name}${count > 1 ? ' ' + (i + 1) : ''}`);
                const hasGearset = !!gearset.export_string;

                const routeNames = gearset.route_names || [];
                // Build expandable route list from route_ids if available
                const routeIds = gearset.route_ids || [];
                let routeDisplayNames = routeNames;
                if (!routeDisplayNames.length && routeIds.length) {
                    routeDisplayNames = routeIds.map(rid => {
                        const route = this.routes.find(r => r.id === rid);
                        return route ? this._formatRouteName(route.name, route._oneWay) : rid;
                    });
                } else {
                    routeDisplayNames = routeDisplayNames.map(n => this._formatRouteName(n));
                }
                let routeListHtml = '';
                if (routeDisplayNames.length && (mode === 'multi' || mode === 'long_short')) {
                    const items = routeDisplayNames.map(n => `<div class="travel-req-route-item">${this._escapeHtml(n)}</div>`).join('');
                    routeListHtml = `
                        <details class="travel-req-routes-details">
                            <summary class="travel-req-routes-summary">Routes (${routeDisplayNames.length})</summary>
                            <div class="travel-req-routes-list">${items}</div>
                        </details>
                    `;
                } else {
                    routeListHtml = this._renderRouteList(routeDisplayNames, mode);
                }

                html += `
                    <div class="travel-gearset-slot" data-slot="${slotKey}">
                        <div class="travel-gearset-slot-header">
                            ${this._renderColorSwatch(gearset.color || this.region.color, slotKey)}
                            <span class="travel-gearset-name">${name}</span>
                        </div>
                        <div class="travel-gearset-slot-body">
                            ${hasGearset ? this._renderAssignedGearset(gearset, routeListHtml) : this._renderEmptyGearset(isOptimizing)}
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * Render advanced mode slots with grouping support.
     * Grouped entries appear first, then individual (ungrouped) slots with checkboxes.
     * Req 4.12, 4.13, 4.14
     */
    _renderAdvancedSlots() {
        const gearsets = this.regionConfig.gearsets || {};
        const count = this.routeCount;

        // Separate grouped and individual slot keys
        const groupedKeys = [];
        const individualKeys = [];

        // Collect all slot keys — individual slots are "1", "2", etc.
        // Grouped slots have comma-separated keys like "1,3,5"
        for (const key of Object.keys(gearsets)) {
            if (gearsets[key].grouped) {
                groupedKeys.push(key);
            }
        }

        // Determine which individual slots are NOT part of any group
        const groupedIndividuals = new Set();
        for (const gk of groupedKeys) {
            for (const id of gk.split(',')) {
                groupedIndividuals.add(id);
            }
        }

        // Also exclude cross-region exception routes from individual slots
        const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));

        for (let i = 0; i < count; i++) {
            const slotKey = String(i + 1);
            if (groupedIndividuals.has(slotKey)) continue;
            // Skip cross-region routes — they have their own section
            const route = this.routes[i];
            if (route && exIds.has(route.id)) continue;
            individualKeys.push(slotKey);
        }

        // Sort individual slots alphabetically by normalized route name
        individualKeys.sort((a, b) => {
            const nameA = this._getRouteDisplayNamePlain(parseInt(a, 10) - 1);
            const nameB = this._getRouteDisplayNamePlain(parseInt(b, 10) - 1);
            return nameA.localeCompare(nameB);
        });

        let html = '';

        // Render grouped entries first — with checkbox and expandable route list
        for (const groupKey of groupedKeys) {
            const gearset = gearsets[groupKey] || {};
            const isOptimizing = this._optimizingSlots.has(groupKey);
            const name = isOptimizing
                ? '<span class="travel-opt-spinner">⏳</span> Optimizing…'
                : this._escapeHtml(gearset.name || this._buildGroupName(groupKey));
            const hasGearset = !!gearset.export_string;
            const routeNames = gearset.route_names || [];
            const routeListHtml = this._renderRouteList(routeNames, 'advanced');
            const isChecked = this._selectedSlots.has(groupKey);
            const isExpanded = this._expandedGroups?.has(groupKey);
            const slotKeys = groupKey.split(',');

            // Build expandable route list using <details> pattern (with ✕ remove buttons)
            const expandedRoutesHtml = `
                <details class="travel-req-routes-details"${isExpanded ? ' open' : ''}>
                    <summary class="travel-req-routes-summary">Routes (${slotKeys.length})</summary>
                    <div class="travel-req-routes-list">
                        ${slotKeys.map((sk, i) => {
                const slotIndex = parseInt(sk, 10) - 1;
                const routeName = this._formatRouteName(
                    routeNames[i] || this._getRouteDisplayNamePlain(slotIndex),
                    this.routes[slotIndex]?._oneWay
                );
                return `<div class="travel-group-route-entry">
                                <button class="travel-group-route-remove" data-group-key="${groupKey}" data-slot-key="${sk}" title="Remove from group">✕</button>
                                <span class="travel-group-route-name">${this._escapeHtml(routeName)}</span>
                            </div>`;
            }).join('')}
                    </div>
                </details>
            `;

            html += `
                <div class="travel-gearset-slot travel-gearset-slot--grouped ${isChecked ? 'travel-gearset-slot--selected' : ''}" data-slot="${groupKey}">
                    <div class="travel-gearset-slot-header">
                        <label class="travel-gearset-select-cb-label">
                            <input type="checkbox" class="travel-gearset-select-cb"
                                   data-slot="${groupKey}" ${isChecked ? 'checked' : ''} />
                        </label>
                        ${this._renderColorSwatch(gearset.color || this.region.color, groupKey)}
                        <span class="travel-gearset-name">${name}</span>
                    </div>
                    ${expandedRoutesHtml}
                    <div class="travel-gearset-slot-body">
                        ${hasGearset ? this._renderAssignedGearset(gearset, routeListHtml) : this._renderEmptyGearset(isOptimizing)}
                    </div>
                </div>
            `;
        }

        // "Group Selected" button — only visible when 2+ individual slots are checked
        const selectedCount = this._selectedSlots.size;
        const showGroupBtn = selectedCount >= 2;
        console.log(`[TravelRegionCard:${this.region.id}] Rendering group bar: selectedCount=${selectedCount}, showGroupBtn=${showGroupBtn}, selectedSlots=[${[...this._selectedSlots].join(',')}]`);
        html += `
            <div class="travel-advanced-group-bar ${showGroupBtn ? '' : 'hidden'}">
                <button class="button button-primary travel-group-selected-btn">
                    Group Selected (${selectedCount})
                </button>
            </div>
        `;

        // Render individual (ungrouped) slots with selection checkboxes
        for (const slotKey of individualKeys) {
            const gearset = gearsets[slotKey] || {};
            const slotIndex = parseInt(slotKey, 10) - 1;
            const isOptimizing = this._optimizingSlots.has(slotKey);
            const name = isOptimizing
                ? '<span class="travel-opt-spinner">⏳</span> Optimizing…'
                : this._getRouteDisplayName(slotIndex);
            const reqs = this._getRouteRequirements(slotIndex);
            const reqsHtml = reqs.length
                ? `<div class="travel-route-reqs">${reqs.map(r => `<span class="travel-route-req">${this._escapeHtml(r)}</span>`).join('')}</div>`
                : '';
            const hasGearset = !!gearset.export_string;
            const routeDisplayName = this._getRouteDisplayNamePlain(slotIndex);
            // Expandable route list (same pattern as multi, no ✕ for individual slots)
            const routeListHtml = `
                <details class="travel-req-routes-details">
                    <summary class="travel-req-routes-summary">Routes (1)</summary>
                    <div class="travel-req-routes-list">
                        <div class="travel-req-route-item">${this._escapeHtml(routeDisplayName)}</div>
                    </div>
                </details>
            `;
            const isChecked = this._selectedSlots.has(slotKey);

            html += `
                <div class="travel-gearset-slot ${isChecked ? 'travel-gearset-slot--selected' : ''}" data-slot="${slotKey}">
                    <div class="travel-gearset-slot-header">
                        <label class="travel-gearset-select-cb-label">
                            <input type="checkbox" class="travel-gearset-select-cb"
                                   data-slot="${slotKey}" ${isChecked ? 'checked' : ''} />
                        </label>
                        ${this._renderColorSwatch(gearset.color || this.region.color, slotKey)}
                        <span class="travel-gearset-name">${name}</span>
                    </div>
                    ${reqsHtml}
                    ${routeListHtml}
                    <div class="travel-gearset-slot-body">
                        ${hasGearset ? this._renderAssignedGearset(gearset, '') : this._renderEmptyGearset(isOptimizing)}
                    </div>
                </div>
            `;
        }

        return html;
    }

    /**
     * Render requirements mode — one gearset slot per requirement group.
     * Routes are auto-grouped by their terrainModifiers.
     */
    _renderRequirementsSlots() {
        const groups = this._getRequirementGroups();
        let html = '';

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const slotKey = `req_${i}`;
            const gearset = this.regionConfig.gearsets?.[slotKey] || {};
            const hasGearset = !!gearset.export_string;
            const isOptimizing = this._optimizingSlots.has(slotKey);
            const displayName = isOptimizing
                ? '<span class="travel-opt-spinner">⏳</span> Optimizing…'
                : (gearset.name || this.region.name + ' ' + (i + 1));

            // Group label
            const labelClass = group.key === '__none__' ? '' : 'travel-req-group-label--has-reqs';
            const reqBadges = group.reqs.length
                ? group.reqs.map(r => `<span class="travel-route-req">${this._escapeHtml(r)}</span>`).join('')
                : '';

            // Route list (expandable)
            const routeListItems = group.routeNames.map(n => `<div class="travel-req-route-item">${this._escapeHtml(this._formatRouteName(n))}</div>`).join('');

            html += `
                <div class="travel-gearset-slot travel-req-group-slot" data-slot="${slotKey}">
                    <div class="travel-gearset-slot-header">
                        ${this._renderColorSwatch(gearset.color || this.region.color, slotKey)}
                        <span class="travel-gearset-name">${displayName}</span>
                        <span class="travel-req-group-count">${group.slotKeys.length} routes</span>
                    </div>
                    ${reqBadges ? `<div class="travel-route-reqs">${reqBadges}</div>` : ''}
                    <details class="travel-req-routes-details">
                        <summary class="travel-req-routes-summary">Routes (${group.routeNames.length})</summary>
                        <div class="travel-req-routes-list">${routeListItems}</div>
                    </details>
                    <div class="travel-gearset-slot-body">
                        ${hasGearset ? this._renderAssignedGearset(gearset) : this._renderEmptyGearset(isOptimizing)}
                    </div>
                </div>
            `;
        }

        return html;
    }

    /**
     * Build a display name for a grouped entry from its comma-separated slot keys.
     * @param {string} groupKey - e.g. "1,3,5"
     * @returns {string}
     */
    _buildGroupName(groupKey) {
        const slotKeys = groupKey.split(',');
        const gearsets = this.regionConfig.gearsets || {};
        const names = slotKeys.map(k => {
            const gs = gearsets[k];
            // Use the individual gearset's route_names if available
            if (gs && gs.route_names && gs.route_names.length) {
                return gs.route_names[0];
            }
            return `${this.region.name} ${k}`;
        });
        if (names.length <= 3) {
            return names.join(', ');
        }
        return `${names.slice(0, 2).join(', ')} (+${names.length - 2} more)`;
    }

    _renderEmptyGearset(isOptimizing = false) {
        const mode = this.regionConfig.mode || 'single';
        const showSelectImport = mode !== 'multi' && mode !== 'long_short';
        const btnClass = isOptimizing ? 'button button-primary travel-gearset-optimize-btn optimizing' : 'button button-primary travel-gearset-optimize-btn';
        const btnText = isOptimizing ? '<span class="travel-opt-spinner">⏳</span> Optimizing…' : 'Optimize';
        const btnDisabled = isOptimizing ? 'disabled' : '';
        return `
            <div class="travel-gearset-empty">${isOptimizing ? 'Optimizing…' : 'No gearset assigned'}</div>
            <div class="travel-gearset-actions">
                <button class="${btnClass}" ${btnDisabled}>${btnText}</button>
                ${showSelectImport ? '<button class="button travel-gearset-select-btn">Select Existing</button>' : ''}
                ${showSelectImport ? '<button class="button travel-gearset-import-btn">Import</button>' : ''}
            </div>
        `;
    }

    _renderAssignedGearset(gearset, routeListHtml = '') {
        const mode = this.regionConfig.mode || 'single';
        const showSelectImport = mode !== 'multi' && mode !== 'long_short';
        const stats = gearset.stats || {};
        const we = stats.we != null ? formatFixed(stats.we, 1) + '%' : '—';
        const da = stats.da != null ? formatFixed(stats.da, 1) + '%' : '—';
        const stepsAdd = stats.steps_add != null && stats.steps_add !== 0
            ? (stats.steps_add > 0 ? '+' : '') + formatFixed(stats.steps_add, 0)
            : null;
        const stepsPct = stats.steps_percent != null && stats.steps_percent !== 0
            ? (stats.steps_percent > 0 ? '+' : '') + formatFixed(stats.steps_percent, 1) + '%'
            : null;
        const reqsMet = stats.requirements_met !== false;
        const reqsIcon = reqsMet ? '✓' : '⚠';
        const reqsClass = reqsMet ? 'travel-reqs-met' : 'travel-reqs-unmet';

        // Render specific terrain requirement warnings (Req 9.2-9.5)
        const warnings = gearset._validation_warnings || [];
        let warningsHtml = '';
        if (warnings.length) {
            const items = warnings.map(w => {
                const icon = this._getWarningIcon(w);
                return `<div class="travel-gearset-warning-item">${icon} ${this._escapeHtml(w)}</div>`;
            }).join('');
            warningsHtml = `<div class="travel-gearset-warnings">${items}</div>`;
        }

        return `
            <div class="travel-gearset-stats">
                <span class="travel-gearset-stat"><img src="/assets/icons/attributes/work_efficiency.svg" class="travel-stat-icon" alt="WE" /> ${we}</span>
                <span class="travel-gearset-stat"><img src="/assets/icons/attributes/double_action.svg" class="travel-stat-icon" alt="DA" /> ${da}</span>
                ${stepsAdd != null ? `<span class="travel-gearset-stat"><img src="/assets/icons/attributes/steps_required.svg" class="travel-stat-icon" alt="Steps" /> ${stepsAdd}</span>` : ''}
                ${stepsPct != null ? `<span class="travel-gearset-stat"><img src="/assets/icons/attributes/steps_required.svg" class="travel-stat-icon" alt="Steps%" /> ${stepsPct}</span>` : ''}
            </div>
            <div class="travel-gearset-stats travel-gearset-stats--row2">
                <span class="travel-gearset-stat ${reqsClass}">${reqsIcon} Reqs</span>
                <button class="travel-gear-preview-toggle" title="Show equipped gear"><span class="expand-arrow">▼</span> Gear</button>
            </div>
            <div class="travel-gear-preview"></div>
            ${warningsHtml}
            ${routeListHtml}
            <div class="travel-gearset-actions">
                <button class="button button-primary travel-gearset-optimize-btn">Optimize</button>
                ${showSelectImport ? '<button class="button travel-gearset-select-btn">Select Existing</button>' : ''}
                ${showSelectImport ? '<button class="button travel-gearset-import-btn">Import</button>' : ''}
                <button class="button travel-gearset-equip-btn">Equip</button>
                <button class="button travel-gearset-export-btn">Export</button>
                <button class="button travel-gearset-clear-btn" title="Clear this gearset">Clear</button>
            </div>
        `;
    }

    /**
     * Render the "Optimize All" button for this region.
     * Triggers optimization for all empty RouteGearsets in this region.
     * Req 4.11: Each Region_Card SHALL display a single "Optimize All" button.
     */
    _renderOptimizeAllButton() {
        const mode = this.regionConfig.mode || 'single';
        if (mode === 'skip') return '';

        // Check if any slots are empty (no gearset assigned)
        const hasEmptySlots = this._hasEmptyGearsetSlots();
        if (!hasEmptySlots) return '';

        return `
            <div class="travel-optimize-all-row">
                <button class="button button-primary travel-optimize-all-btn">
                    ▶ Optimize All
                </button>
            </div>
        `;
    }

    /**
     * Check if any gearset slots in this region are empty (no export_string).
     * @returns {boolean}
     */
    _hasEmptyGearsetSlots() {
        const mode = this.regionConfig.mode || 'single';
        const gearsets = this.regionConfig.gearsets || {};
        const count = this._getGearsetCount();

        if (mode === 'single') {
            return !gearsets.single?.export_string;
        }

        if (mode === 'long_short' || mode === 'multi') {
            // Multi/long_short: check if the multi result exists
            // These modes produce results as numbered slots
            for (let i = 1; i <= count; i++) {
                if (!gearsets[String(i)]?.export_string) return true;
            }
            return false;
        }

        if (mode === 'advanced') {
            for (let i = 1; i <= this.routeCount; i++) {
                const slotKey = String(i);
                if (gearsets[slotKey]?.export_string) continue;
                // Check if this slot is part of a group that has a gearset
                const groupKey = Object.keys(gearsets).find(k =>
                    k.includes(',') && k.split(',').includes(slotKey)
                );
                if (groupKey && gearsets[groupKey]?.export_string) continue;
                return true;
            }
            return false;
        }

        if (mode === 'requirements') {
            const groups = this._getRequirementGroups();
            for (let i = 0; i < groups.length; i++) {
                if (!gearsets[`req_${i}`]?.export_string) return true;
            }
            return false;
        }

        return true;
    }

    _renderAdvancedEditButton() {
        const mode = this.regionConfig.mode || 'single';
        const showAdvancedEdit = (mode === 'single' || mode === 'long_short' || mode === 'multi' || mode === 'requirements');
        if (!showAdvancedEdit) return '';
        return `
            <div class="travel-advanced-edit-row">
                <button class="button travel-advanced-edit-btn" title="Switch to Advanced mode for fine-tuning">Advanced Edit ▸</button>
            </div>
        `;
    }

    _renderResetButton() {
        return `
            <div class="travel-region-reset-row" style="text-align: center; margin-top: 8px;">
                <button class="button travel-region-reset-btn">Reset Region</button>
            </div>
        `;
    }

    /**
     * Render exception routes inline under this region card.
     * Only shown when show_exception_routes is false (Req 6.3).
     * Each entry shows route name, unmet requirement, and a RouteGearset.
     * Requirements: 6.3, 6.4, 6.5, 6.6, 6.7
     */
    _renderInlineExceptionRoutes() {
        if (!this.exceptionRoutes || !this.exceptionRoutes.length) return '';

        let html = `
            <div class="travel-exception-routes-inline">
                <div class="travel-exception-routes-header">
                    <span class="travel-exception-routes-title">Cross Region Routes</span>
                    <span class="travel-info-icon" data-info="Cross-region routes where the same gearset won't give the same steps in both directions due to different regional stats. Each direction is optimized independently." role="button" tabindex="0" aria-label="Cross region routes info">ⓘ</span>
                </div>
        `;

        for (const exRoute of this.exceptionRoutes) {
            const routeId = exRoute.id;
            const exConfig = this.exceptionsConfig[routeId] || {};
            const gearset = exConfig.gearset || {};
            const hasGearset = !!gearset.export_string;
            const isOptimizing = gearset._task_status === 'running';
            const unmetReqs = exRoute.unmetRequirements || [];
            const reqText = unmetReqs.map(r => {
                const rl = r.toLowerCase();
                if (rl.includes('expert diving')) return 'Expert Diving';
                if (rl.includes('advanced diving')) return 'Adv. Diving';
                if (rl.includes('diving')) return 'Diving';
                if (rl.includes('ski')) return 'Skis';
                if (rl.includes('light')) return 'Light';
                return r.replace(/^Requires\s*/i, '');
            }).join(', ');

            const displayName = gearset.name || exRoute.name || routeId;

            // Color swatch
            const FACTION_COLORS_MAP = {
                jarvonia: '#bbdefa', trellin: '#a0e870', erdwise: '#fec08d',
                halfling_rebels: '#b8c375', syrenthia: '#c7b6fc',
                wallisia: '#e8a060', wrentmark: '#f0d080',
            };
            const swatchColor = gearset.color || FACTION_COLORS_MAP[exRoute.toRegion] || this.region.color || '#888';
            const pickerId = `color-picker-ex-${routeId.replace(/[^a-z0-9]/gi, '_')}`;
            const swatchHtml = this._renderColorSwatch(swatchColor, `ex_${routeId}`).replace(
                /data-slot="[^"]*"/g,
                `data-route-id="${this._escapeHtml(routeId)}"`
            );

            let bodyHtml;
            if (hasGearset) {
                bodyHtml = this._renderExceptionAssigned(gearset, isOptimizing);
            } else {
                bodyHtml = this._renderExceptionEmpty(isOptimizing);
            }

            html += `
                <div class="travel-gearset-slot travel-exception-route-entry" data-route-id="${this._escapeHtml(routeId)}">
                    <div class="travel-gearset-slot-header">
                        ${swatchHtml}
                        <span class="travel-gearset-name">${this._escapeHtml(displayName)}</span>
                        ${reqText ? `<span class="travel-exception-req-badge">${reqText}</span>` : ''}
                    </div>
                    <div class="travel-gearset-slot-body">
                        ${bodyHtml}
                    </div>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    _renderExceptionEmpty(isOptimizing = false) {
        const btnClass = isOptimizing ? 'button button-primary travel-exception-optimize-btn optimizing' : 'button button-primary travel-exception-optimize-btn';
        const btnText = isOptimizing ? '<span class="travel-opt-spinner">⏳</span> Optimizing…' : 'Optimize';
        const btnDisabled = isOptimizing ? 'disabled' : '';
        return `
            <div class="travel-gearset-empty">${isOptimizing ? '<span class="travel-opt-spinner">⏳</span> Optimizing…' : 'No gearset assigned'}</div>
            <div class="travel-gearset-actions">
                <button class="${btnClass}" ${btnDisabled}>${btnText}</button>
                <button class="button travel-exception-select-btn"${isOptimizing ? ' disabled' : ''}>Select Existing</button>
                <button class="button travel-exception-import-btn"${isOptimizing ? ' disabled' : ''}>Import</button>
            </div>
        `;
    }

    _renderExceptionAssigned(gearset, isOptimizing = false) {
        const stats = gearset.stats || {};
        const we = stats.we != null ? formatFixed(stats.we, 1) + '%' : '—';
        const da = stats.da != null ? formatFixed(stats.da, 1) + '%' : '—';
        const stepsAdd = stats.steps_add != null && stats.steps_add !== 0
            ? (stats.steps_add > 0 ? '+' : '') + formatFixed(stats.steps_add, 0)
            : null;
        const stepsPct = stats.steps_percent != null && stats.steps_percent !== 0
            ? (stats.steps_percent > 0 ? '+' : '') + formatFixed(stats.steps_percent, 1) + '%'
            : null;
        const reqsMet = stats.requirements_met !== false;
        const reqsIcon = reqsMet ? '✓' : '⚠';
        const reqsClass = reqsMet ? 'travel-reqs-met' : 'travel-reqs-unmet';

        // Render specific terrain requirement warnings (Req 9.2-9.5)
        const warnings = gearset._validation_warnings || [];
        let warningsHtml = '';
        if (warnings.length) {
            const items = warnings.map(w => {
                const icon = this._getWarningIcon(w);
                return `<div class="travel-gearset-warning-item">${icon} ${this._escapeHtml(w)}</div>`;
            }).join('');
            warningsHtml = `<div class="travel-gearset-warnings">${items}</div>`;
        }

        return `
            <div class="travel-gearset-stats">
                <span class="travel-gearset-stat"><img src="/assets/icons/attributes/work_efficiency.svg" class="travel-stat-icon" alt="WE" /> ${we}</span>
                <span class="travel-gearset-stat"><img src="/assets/icons/attributes/double_action.svg" class="travel-stat-icon" alt="DA" /> ${da}</span>
                ${stepsAdd != null ? `<span class="travel-gearset-stat"><img src="/assets/icons/attributes/steps_required.svg" class="travel-stat-icon" alt="Steps" /> ${stepsAdd}</span>` : ''}
                ${stepsPct != null ? `<span class="travel-gearset-stat"><img src="/assets/icons/attributes/steps_required.svg" class="travel-stat-icon" alt="Steps%" /> ${stepsPct}</span>` : ''}
            </div>
            <div class="travel-gearset-stats travel-gearset-stats--row2">
                <span class="travel-gearset-stat ${reqsClass}">${reqsIcon} Reqs</span>
                <button class="travel-gear-preview-toggle" title="Show equipped gear"><span class="expand-arrow">▼</span> Gear</button>
            </div>
            <div class="travel-gear-preview"></div>
            ${warningsHtml}
            <div class="travel-gearset-actions">
                <button class="button button-primary travel-exception-optimize-btn${isOptimizing ? ' optimizing' : ''}"${isOptimizing ? ' disabled' : ''}>${isOptimizing ? '<span class="travel-opt-spinner">⏳</span> Optimizing…' : 'Optimize'}</button>
                <button class="button travel-exception-select-btn"${isOptimizing ? ' disabled' : ''}>Select Existing</button>
                <button class="button travel-exception-import-btn"${isOptimizing ? ' disabled' : ''}>Import</button>
                <button class="button travel-exception-equip-btn"${isOptimizing ? ' disabled' : ''}>Equip</button>
                <button class="button travel-exception-export-btn"${isOptimizing ? ' disabled' : ''}>Export</button>
                <button class="button travel-exception-clear-btn"${isOptimizing ? ' disabled' : ''}>Clear</button>
            </div>
        `;
    }

    /**
     * Render a compact route list for a gearset slot.
     * Req 4.8: Show route list under each gearset (which routes it covers).
     * Only shown for long_short, multi, or advanced modes with non-empty route names.
     * @param {string[]} routeNames - Array of route display names
     * @param {string} mode - Current gearset mode
     * @returns {string} HTML string
     * @private
     */
    _renderRouteList(routeNames, mode) {
        const showModes = ['multi', 'long_short', 'advanced'];
        if (!routeNames || !routeNames.length || !showModes.includes(mode)) {
            return '';
        }

        const MAX_VISIBLE = 2;
        const visible = routeNames.slice(0, MAX_VISIBLE);
        const remaining = routeNames.length - MAX_VISIBLE;

        const escapeHtml = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };

        let routeText = visible.map(n => escapeHtml(n)).join(', ');
        if (remaining > 0) {
            routeText += ` <span class="travel-route-list-more">(+${remaining} more)</span>`;
        }

        return `
            <div class="travel-route-list" title="${routeNames.join(', ')}">
                <span class="travel-route-list-label">Routes:</span> ${routeText}
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    _attachEvents() {
        // Enable checkbox
        const enableCb = this.el.querySelector('.travel-region-enable-cb');
        if (enableCb) {
            enableCb.addEventListener('change', (e) => {
                this.regionConfig.enabled = e.target.checked;
                this.onConfigChange('enabled', e.target.checked);
                // Show/hide routes and location icons on the map
                if (window.travelMap) {
                    // Use _originalId for reverse routes so the map finds the real route
                    const allRouteIds = this.routes.map(r => r._originalId || r.id);
                    window.travelMap.setRouteVisibility(allRouteIds, e.target.checked);
                    // Also hide/show exception routes for this region
                    for (const exRoute of (this.exceptionRoutes || [])) {
                        window.travelMap.setRouteVisibility([exRoute.id], e.target.checked);
                    }
                }
                this._render();
            });
        }

        // Collapse toggle — click on header (but not checkbox or reset button)
        const header = this.el.querySelector('.travel-region-card-header');
        if (header) {
            header.addEventListener('click', (e) => {
                if (e.target.closest('.travel-region-enable')) return;
                if (e.target.closest('.travel-region-header-reset-btn')) return;
                this._collapsed = !this._collapsed;
                const body = this.el.querySelector('.travel-region-card-body');
                const arrow = this.el.querySelector('.expand-arrow');
                if (body) {
                    if (this._collapsed) {
                        $(body).slideUp(200);
                    } else {
                        $(body).slideDown(200, () => {
                            // Scroll the region header to the top of the config panel
                            this.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        });
                    }
                }
                if (arrow) arrow.classList.toggle('expanded', !this._collapsed);
                this.el.classList.toggle('travel-region-card--collapsed', this._collapsed);
            });
        }

        // Header reset button (top-right)
        const headerResetBtn = this.el.querySelector('.travel-region-header-reset-btn');
        if (headerResetBtn) {
            headerResetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._onResetClick(headerResetBtn);
            });
        }

        // Mode selector
        const modeSelect = this.el.querySelector('.travel-mode-select');
        if (modeSelect) {
            modeSelect.addEventListener('change', (e) => {
                this.regionConfig.mode = e.target.value;
                // Ensure multi_count is at least 2 when switching to multi mode
                if (e.target.value === 'multi' && (!this.regionConfig.multi_count || this.regionConfig.multi_count < 2)) {
                    this.regionConfig.multi_count = 2;
                }
                this._selectedSlots.clear();
                this.onConfigChange('mode', e.target.value);
                this._render();
                // Push default region color to all routes on mode change
                this._pushDefaultColors();
            });
        }

        // Multi slider
        const slider = this.el.querySelector('.travel-multi-slider-input');
        if (slider) {
            // Track the committed count so the change handler can detect actual changes
            // (the input handler updates multi_count live for display, which would make oldVal === newVal)
            this._committedMultiCount = this.regionConfig.multi_count || 2;
            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                this.regionConfig.multi_count = val;
                const display = this.el.querySelector('.travel-multi-count-display');
                if (display) display.textContent = val;
            });
            slider.addEventListener('change', (e) => {
                const newVal = parseInt(e.target.value, 10);
                const oldVal = this._committedMultiCount || 2;

                // Stash current gearsets under the old count so we can restore them
                if (oldVal !== newVal) {
                    const currentGearsets = this.regionConfig.gearsets || {};
                    // Save numbered slots for the old count
                    const stash = {};
                    for (let i = 1; i <= oldVal; i++) {
                        const k = String(i);
                        if (currentGearsets[k]) stash[k] = { ...currentGearsets[k] };
                    }
                    if (!this.regionConfig._multi_stash) this.regionConfig._multi_stash = {};
                    this.regionConfig._multi_stash[oldVal] = stash;
                    // Also stash the breakpoint for this count
                    if (!this.regionConfig._multi_breakpoint_stash) this.regionConfig._multi_breakpoint_stash = {};
                    this.regionConfig._multi_breakpoint_stash[oldVal] = this.regionConfig.breakpoint ?? null;

                    // Try to restore from stash for the new count
                    const cached = this.regionConfig._multi_stash?.[newVal];
                    if (cached) {
                        for (let i = 1; i <= newVal; i++) {
                            const k = String(i);
                            if (cached[k]) {
                                currentGearsets[k] = { ...cached[k] };
                            } else {
                                delete currentGearsets[k];
                            }
                        }
                    } else {
                        for (let i = 1; i <= Math.max(oldVal, newVal); i++) {
                            delete currentGearsets[String(i)];
                        }
                    }
                    // Clean up slots beyond the new count
                    for (let i = newVal + 1; i <= oldVal; i++) {
                        delete currentGearsets[String(i)];
                    }
                    // Only clear names/colors/route_ids when NOT restoring from cache
                    if (!cached) {
                        for (let i = 1; i <= newVal; i++) {
                            const k = String(i);
                            if (currentGearsets[k]) {
                                currentGearsets[k].name = null;
                                currentGearsets[k].color = null;
                                currentGearsets[k].route_ids = [];
                                currentGearsets[k].route_names = [];
                            }
                        }
                    }
                    this.regionConfig.gearsets = currentGearsets;
                    this.regionConfig.breakpoint = null;
                    // Restore breakpoint from stash if available
                    if (this.regionConfig._multi_breakpoint_stash?.[newVal] !== undefined) {
                        this.regionConfig.breakpoint = this.regionConfig._multi_breakpoint_stash[newVal];
                    }
                    // Push colors to map — use cached colors or reset to faction default
                    if (cached) {
                        const colorMap = {};
                        for (let i = 1; i <= newVal; i++) {
                            const k = String(i);
                            const gs = currentGearsets[k];
                            if (gs?.route_ids?.length && gs.color) {
                                for (const rid of gs.route_ids) {
                                    colorMap[rid] = gs.color;
                                }
                            }
                        }
                        if (Object.keys(colorMap).length) {
                            this.onRouteColorChange(
                                Object.keys(colorMap),
                                null // Will be handled per-route below
                            );
                            // Push individual colors
                            for (const [rid, color] of Object.entries(colorMap)) {
                                this.onRouteColorChange([rid], color);
                            }
                        }
                    } else {
                        const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
                        const allRouteIds = this.routes.filter(r => !exIds.has(r.id)).map(r => r.id);
                        if (allRouteIds.length) this.onRouteColorChange(allRouteIds, this.region.color || '#888');
                    }
                }

                this.regionConfig.multi_count = newVal;
                this._committedMultiCount = newVal;
                delete this.regionConfig._multi_max_note;  // Clear note when user changes count
                this.onConfigChange('multi_count', newVal);
                this.onConfigChange('gearsets', this.regionConfig.gearsets);
                this._render();
            });
        }

        // Animated expand/collapse for route lists
        const detailsEls = this.el.querySelectorAll('.travel-req-routes-details');
        for (const details of detailsEls) {
            const summary = details.querySelector('.travel-req-routes-summary');
            const list = details.querySelector('.travel-req-routes-list');
            if (!summary || !list) continue;

            summary.addEventListener('click', (e) => {
                e.preventDefault();
                if (details.open) {
                    // Collapse: animate then close
                    list.classList.add('collapsing');
                    list.addEventListener('transitionend', function handler() {
                        list.removeEventListener('transitionend', handler);
                        details.open = false;
                        list.classList.remove('collapsing');
                    }, { once: true });
                } else {
                    // Expand: open then animate in
                    list.classList.add('collapsing');
                    details.open = true;
                    // Force reflow so the transition triggers
                    list.offsetHeight; // eslint-disable-line no-unused-expressions
                    list.classList.remove('collapsing');
                }
            });
        }

        // Reset Region (two-click)
        const resetBtn = this.el.querySelector('.travel-region-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this._onResetClick(resetBtn));
        }

        // Optimize All button (Req 4.11)
        const optimizeAllBtn = this.el.querySelector('.travel-optimize-all-btn');
        if (optimizeAllBtn) {
            optimizeAllBtn.addEventListener('click', () => this._onOptimizeAll());
        }

        // Individual Optimize buttons on gearset slots
        const optimizeBtns = this.el.querySelectorAll('.travel-gearset-optimize-btn');
        for (const btn of optimizeBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;
                this._onOptimizeSlot(slotKey);
            });
        }

        // Advanced mode search — live filter routes without re-render
        const searchInput = this.el.querySelector('.travel-advanced-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this._advancedSearchText = e.target.value;
                this._applyAdvancedSearch(e.target.value);
            });
            // Apply existing search on render (preserves filter after re-render)
            if (this._advancedSearchText) {
                this._applyAdvancedSearch(this._advancedSearchText);
            }
        }

        // Info icons — hover + click popover behavior
        wireInfoIcons(this.el);

        // Gearset name click → focus mode on map (dim other routes, highlight this slot's routes)
        const nameSpans = this.el.querySelectorAll('.travel-gearset-slot .travel-gearset-name');
        for (const nameEl of nameSpans) {
            nameEl.style.cursor = 'pointer';
            nameEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = nameEl.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                const routeId = slot?.dataset.routeId;

                // Cross-region route entry (uses data-route-id)
                if (routeId) {
                    const exConfig = this.exceptionsConfig[routeId] || {};
                    const gs = exConfig.gearset || {};
                    const color = gs.color || this.region.color || '#888';
                    // Use the exception route's display name, not the raw ID
                    const exRoute = (this.exceptionRoutes || []).find(ex => ex.id === routeId);
                    const name = gs.name || exRoute?.name || routeId;
                    if (this._focusedSlot === `ex:${routeId}`) {
                        this._focusedSlot = null;
                        if (window.travelMap) window.travelMap.exitFocusMode();
                    } else {
                        this._focusedSlot = `ex:${routeId}`;
                        if (window.travelMap) window.travelMap.focusRoutes([routeId], color, name);
                    }
                    return;
                }

                if (!slotKey) return;
                const gs = this.regionConfig.gearsets?.[slotKey] || {};
                const routeIds = gs.route_ids || this._getRouteIdsForSlot(slotKey);
                if (!routeIds.length) return;
                const color = gs.color || this.region.color || '#888';
                // Build a descriptive name from route names
                let name = gs.name;
                if (!name) {
                    const mode = this.regionConfig.mode || 'single';
                    if (mode === 'advanced' && !slotKey.includes(',')) {
                        // Individual advanced slot — use route display name
                        const idx = parseInt(slotKey, 10) - 1;
                        name = this._getRouteDisplayNamePlain(idx);
                    } else {
                        name = this.region.name;
                    }
                }
                // Toggle: if already focused on this slot, exit
                if (this._focusedSlot === slotKey) {
                    this._focusedSlot = null;
                    if (window.travelMap) window.travelMap.exitFocusMode();
                } else {
                    this._focusedSlot = slotKey;
                    if (window.travelMap) window.travelMap.focusRoutes(routeIds, color, name);
                }
            });
        }

        // Color picker — label wraps swatch+input so tapping works on mobile
        const pickers = this.el.querySelectorAll('.travel-gearset-color-picker');
        for (const picker of pickers) {
            const slotKey = picker.dataset.slot;
            const swatch = picker.parentElement?.querySelector(`.travel-gearset-color-swatch[data-slot="${slotKey}"]`);

            const updateSwatchColor = (color) => {
                if (!swatch) return;
                // Update the SVG paint fills (paint inside can + spill)
                const svg = swatch.querySelector('svg');
                if (svg) {
                    const fills = svg.querySelectorAll('[fill]');
                    for (const el of fills) {
                        const f = el.getAttribute('fill');
                        if (f && f !== 'none' && !f.startsWith('rgba')) {
                            el.setAttribute('fill', color);
                        }
                    }
                }
            };

            picker.addEventListener('input', (e) => {
                updateSwatchColor(e.target.value);
                const routeIds = this._getRouteIdsForSlot(slotKey);
                if (routeIds.length) this.onRouteColorChange(routeIds, e.target.value);
            });

            picker.addEventListener('change', (e) => {
                const newColor = e.target.value;
                updateSwatchColor(newColor);
                if (!this.regionConfig.gearsets) this.regionConfig.gearsets = {};
                if (!this.regionConfig.gearsets[slotKey]) this.regionConfig.gearsets[slotKey] = {};
                this.regionConfig.gearsets[slotKey].color = newColor;
                this.onConfigChange('gearsets', this.regionConfig.gearsets);
                const routeIds = this._getRouteIdsForSlot(slotKey);
                if (routeIds.length) this.onRouteColorChange(routeIds, newColor);
            });
        }

        // Select Existing button — open gearset picker popup
        const selectBtns = this.el.querySelectorAll('.travel-gearset-select-btn');
        for (const btn of selectBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;

                // Scroll the slot to the top of the config panel, then show picker after scroll completes
                const panel = slot.closest('.travel-config-panel-content') || slot.closest('.travel-config-panel');
                if (panel) {
                    panel.scrollTo({ top: panel.scrollTop + slot.getBoundingClientRect().top - panel.getBoundingClientRect().top, behavior: 'smooth' });
                }
                // Delay popup until scroll animation finishes (~350ms)
                setTimeout(() => {
                    showGearsetPicker(btn, (gs) => {
                        if (!this.regionConfig.gearsets) this.regionConfig.gearsets = {};
                        if (!this.regionConfig.gearsets[slotKey]) this.regionConfig.gearsets[slotKey] = {};
                        const exportStr = gs.export_string && gs.export_string !== '__saved__' ? gs.export_string : null;
                        this.regionConfig.gearsets[slotKey].export_string = exportStr;
                        this.regionConfig.gearsets[slotKey].saved_gearset_id = gs.id;
                        this.regionConfig.gearsets[slotKey].name = this.regionConfig.gearsets[slotKey].name || gs.name;
                        this.regionConfig.gearsets[slotKey].stats = null;
                        this.onConfigChange('gearsets', this.regionConfig.gearsets);
                        this._render();
                        // Scroll the slot into view after DOM update
                        setTimeout(() => {
                            const updatedSlot = this.el.querySelector(`.travel-gearset-slot[data-slot="${slotKey}"]`);
                            if (updatedSlot) {
                                // Scroll within the config panel
                                const panel = updatedSlot.closest('.travel-config-panel-content') || updatedSlot.closest('.travel-config-panel');
                                if (panel) {
                                    const panelRect = panel.getBoundingClientRect();
                                    const slotRect = updatedSlot.getBoundingClientRect();
                                    panel.scrollTop += slotRect.top - panelRect.top;
                                } else {
                                    updatedSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }
                        }, 100);
                        // Trigger terrain validation immediately (Req 9.1)
                        this.validateGearsetSlot(slotKey);
                        if (window.api) window.api.showSuccess(`Loaded "${gs.name}"`);
                    });
                }, 350);
            });
        }
        // Import button — open import modal (Req 4.6)
        const importBtns = this.el.querySelectorAll('.travel-gearset-import-btn');
        for (const btn of importBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;

                const gsConfig = this.regionConfig.gearsets?.[slotKey] || {};
                const slotName = gsConfig.name || `${this.region.name} ${slotKey}`;

                showImportGearsetModal({
                    slotName,
                    onConfirm: (result) => {
                        if (!this.regionConfig.gearsets) this.regionConfig.gearsets = {};
                        if (!this.regionConfig.gearsets[slotKey]) this.regionConfig.gearsets[slotKey] = {};
                        this.regionConfig.gearsets[slotKey].export_string = result.export_string;
                        if (result.saved_gearset_id) {
                            this.regionConfig.gearsets[slotKey].saved_gearset_id = result.saved_gearset_id;
                        }
                        if (result.name && !this.regionConfig.gearsets[slotKey].name) {
                            this.regionConfig.gearsets[slotKey].name = result.name;
                        }
                        if (!this.regionConfig.gearsets[slotKey].stats) {
                            this.regionConfig.gearsets[slotKey].stats = null;
                        }
                        this.onConfigChange('gearsets', this.regionConfig.gearsets);
                        this._render();
                        // Trigger terrain validation immediately (Req 9.1)
                        this.validateGearsetSlot(slotKey);
                        if (window.api) window.api.showSuccess('Gear set imported.');
                    },
                });
            });
        }

        // Equip button — load gearset into Column 2 (Gear Stats)
        const equipBtns = this.el.querySelectorAll('.travel-gearset-equip-btn');
        for (const btn of equipBtns) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;
                const gs = this.regionConfig.gearsets?.[slotKey];
                const exportStr = gs?.export_string;
                if (!exportStr) return;
                try {
                    const { default: store } = await import('./state.js');
                    await store.loadGearSetFromExport(exportStr, null, gs.name || `${this.region.name} ${slotKey}`);
                    if (window.api) window.api.showSuccess('Loaded gearset into Gear Stats.');
                    // Navigate to the main column view to show the equipped gearset
                    window.location.hash = '';
                } catch (err) {
                    if (window.api) window.api.showError('Failed to load gearset.');
                }
            });
        }

        // Export button — copy export string to clipboard
        const exportBtns = this.el.querySelectorAll('.travel-gearset-export-btn');
        for (const btn of exportBtns) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;
                const gs = this.regionConfig.gearsets?.[slotKey];
                const exportStr = gs?.export_string;
                if (!exportStr) return;
                try {
                    await navigator.clipboard.writeText(exportStr);
                    if (window.api) window.api.showSuccess('Export string copied to clipboard.');
                } catch (err) {
                    if (window.api) window.api.showError('Failed to copy to clipboard.');
                }
            });
        }

        // Gear preview toggle — show/hide tiny gear icons
        for (const btn of this.el.querySelectorAll('.travel-gear-preview-toggle')) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey) return;
                const preview = slot.querySelector('.travel-gear-preview');
                if (!preview) return;

                const isOpen = btn.classList.contains('open');
                if (isOpen) {
                    btn.classList.remove('open');
                    preview.classList.remove('open');
                    return;
                }

                if (!preview.dataset.loaded) {
                    const gs = this.regionConfig.gearsets?.[slotKey];
                    const exportStr = gs?.export_string;
                    if (!exportStr) return;
                    try {
                        const html = await this._buildGearPreviewHtml(exportStr);
                        preview.innerHTML = html;
                        preview.dataset.loaded = '1';
                    } catch (err) {
                        preview.innerHTML = '<span style="font-size:11px;color:var(--text-secondary)">Could not load gear</span>';
                    }
                }

                btn.classList.add('open');
                preview.classList.add('open');
            });
        }

        // Clear button — reset a single gearset slot
        const clearBtns = this.el.querySelectorAll('.travel-gearset-clear-btn');
        for (const btn of clearBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const slot = btn.closest('.travel-gearset-slot');
                const slotKey = slot?.dataset.slot;
                if (!slotKey || !this.regionConfig.gearsets) return;
                if (this.regionConfig.gearsets[slotKey]) {
                    this.regionConfig.gearsets[slotKey].export_string = null;
                    this.regionConfig.gearsets[slotKey].saved_gearset_id = null;
                    this.regionConfig.gearsets[slotKey].stats = null;
                    this.regionConfig.gearsets[slotKey].name = null; // Reset to auto-generated name
                    this.regionConfig.gearsets[slotKey]._validation_warnings = [];
                    this.onConfigChange('gearsets', this.regionConfig.gearsets);
                    // Reset map color for this slot's routes
                    // Cross-region routes use destination color, same-region use faction default
                    const routeIds = this._getRouteIdsForSlot(slotKey);
                    if (routeIds.length) {
                        const DEST_CLR = {
                            jarvonia: '#bbdefa', trellin: '#a0e870', erdwise: '#fec08d',
                            halfling_rebels: '#b8c375', syrenthia: '#c7b6fc',
                            wallisia: '#e8a060', wrentmark: '#f0d080',
                        };
                        const sameIds = [];
                        for (const rid of routeIds) {
                            const rt = this.routes.find(r => r.id === rid);
                            if (rt?._oneWay && !rt._isReverse) {
                                const pts = (rt.name || '').split(' to ');
                                if (pts.length === 2) {
                                    const toReg = LOCATION_CANONICAL_REGION[pts[1].trim()];
                                    if (toReg && toReg !== this.region.id) {
                                        this.onRouteColorChange([rid], DEST_CLR[toReg] || '#888');
                                        continue;
                                    }
                                }
                            }
                            sameIds.push(rid);
                        }
                        if (sameIds.length) this.onRouteColorChange(sameIds, this.region.color || '#888');
                    }
                    this._render();
                }
            });
        }

        // Pan to route on title/swatch click (advanced mode individual slots only)
        if ((this.regionConfig.mode || 'single') === 'advanced') {
            const slots = this.el.querySelectorAll('.travel-gearset-slot:not(.travel-gearset-slot--grouped)');
            for (const slot of slots) {
                const slotKey = slot.dataset.slot;
                if (!slotKey || slotKey.includes(',') || slotKey.startsWith('req_')) continue;
                const slotIndex = parseInt(slotKey, 10) - 1;
                const route = this.routes[slotIndex];
                if (!route) continue;

                const header = slot.querySelector('.travel-gearset-slot-header');
                if (header) {
                    header.addEventListener('click', (e) => {
                        // Don't pan if clicking checkbox, color picker, or buttons
                        if (e.target.closest('.travel-gearset-select-cb-label')) return;
                        if (e.target.closest('.travel-gearset-color-picker')) return;
                        if (e.target.closest('button')) return;
                        this.onPanToRoute(route.id);
                    });
                    header.style.cursor = 'pointer';
                }
            }
        }

        // Exception route buttons (inline mode, Req 6.3–6.7)
        const exEntries = this.el.querySelectorAll('.travel-exception-route-entry');
        for (const entry of exEntries) {
            const routeId = entry.dataset.routeId;
            if (!routeId) continue;

            const optBtn = entry.querySelector('.travel-exception-optimize-btn');
            if (optBtn) {
                optBtn.addEventListener('click', () => {
                    // Show loading state — match region gearset slot behavior
                    optBtn.disabled = true;
                    optBtn.classList.add('optimizing');
                    optBtn.innerHTML = '<span class="travel-opt-spinner">⏳</span> Optimizing…';

                    // Show spinning ⏳ on the gearset name
                    const nameEl = entry.querySelector('.travel-gearset-name');
                    if (nameEl) nameEl.innerHTML = '<span class="travel-opt-spinner">⏳</span> Optimizing…';

                    // Disable all other buttons in this entry
                    entry.querySelectorAll('.travel-gearset-actions .button').forEach(btn => {
                        btn.disabled = true;
                    });

                    // Find the exception route data for location info
                    const exRoute = (this.exceptionRoutes || []).find(ex => ex.id === routeId);
                    const taskKey = `exception:${routeId}`;
                    const payload = {
                        task_key: taskKey,
                        region_id: 'exception',
                        gearset_slot: routeId,
                        mode: 'single',
                        route_ids: [routeId],
                    };
                    // Pass location names for flipped routes so backend builds correct tuple
                    if (exRoute?.fromLocation && exRoute?.toLocation) {
                        payload.from_location = exRoute.fromLocation;
                        payload.to_location = exRoute.toLocation;
                    }
                    this.onOptimize(taskKey, payload);
                });
            }

            // Select Existing button
            const selectBtn = entry.querySelector('.travel-exception-select-btn');
            if (selectBtn) {
                selectBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Scroll the entry to the top of the config panel, then show picker after scroll
                    const panel = entry.closest('.travel-config-panel-content') || entry.closest('.travel-config-panel');
                    if (panel) {
                        panel.scrollTo({ top: panel.scrollTop + entry.getBoundingClientRect().top - panel.getBoundingClientRect().top, behavior: 'smooth' });
                    }
                    setTimeout(() => {
                        showGearsetPicker(selectBtn, (gs) => {
                            if (!this.exceptionsConfig[routeId]) this.exceptionsConfig[routeId] = { gearset: {} };
                            if (!this.exceptionsConfig[routeId].gearset) this.exceptionsConfig[routeId].gearset = {};
                            const exportStr = gs.export_string && gs.export_string !== '__saved__' ? gs.export_string : null;
                            this.exceptionsConfig[routeId].gearset.export_string = exportStr;
                            this.exceptionsConfig[routeId].gearset.saved_gearset_id = gs.id;
                            this.exceptionsConfig[routeId].gearset.name = this.exceptionsConfig[routeId].gearset.name || gs.name;
                            this.exceptionsConfig[routeId].gearset.stats = null;
                            this.onExceptionConfigChange(routeId, 'gearset', this.exceptionsConfig[routeId].gearset);
                            this._render();
                            // Compute stats via validate endpoint
                            if (exportStr) {
                                this._validateExceptionSlot(routeId, exportStr);
                            }
                            if (window.api) window.api.showSuccess(`Loaded "${gs.name}"`);
                        });
                    }, 350);
                });
            }

            const impBtn = entry.querySelector('.travel-exception-import-btn');
            if (impBtn) {
                impBtn.addEventListener('click', () => {
                    const exConfig = this.exceptionsConfig[routeId] || {};
                    const slotName = exConfig.gearset?.name || routeId;

                    showImportGearsetModal({
                        slotName,
                        onConfirm: (result) => {
                            if (!this.exceptionsConfig[routeId]) this.exceptionsConfig[routeId] = { gearset: {} };
                            if (!this.exceptionsConfig[routeId].gearset) this.exceptionsConfig[routeId].gearset = {};
                            this.exceptionsConfig[routeId].gearset.export_string = result.export_string;
                            if (result.saved_gearset_id) {
                                this.exceptionsConfig[routeId].gearset.saved_gearset_id = result.saved_gearset_id;
                            }
                            if (result.name) {
                                this.exceptionsConfig[routeId].gearset.name = this.exceptionsConfig[routeId].gearset.name || result.name;
                            }
                            this.onExceptionConfigChange(routeId, 'gearset', this.exceptionsConfig[routeId].gearset);
                            this._render();
                            if (window.api) window.api.showSuccess('Cross-region gear set imported.');
                        },
                    });
                });
            }

            const equipBtn = entry.querySelector('.travel-exception-equip-btn');
            if (equipBtn) {
                equipBtn.addEventListener('click', async () => {
                    const exConfig = this.exceptionsConfig[routeId] || {};
                    const exportStr = exConfig.gearset?.export_string;
                    if (!exportStr) return;
                    try {
                        const { default: store } = await import('./state.js');
                        await store.loadGearSetFromExport(exportStr, null, exConfig.gearset?.name || routeId);
                        if (window.api) window.api.showSuccess('Loaded exception gearset into Gear Stats.');
                        window.location.hash = '';
                    } catch (err) {
                        if (window.api) window.api.showError('Failed to load gearset.');
                    }
                });
            }

            const expBtn = entry.querySelector('.travel-exception-export-btn');
            if (expBtn) {
                expBtn.addEventListener('click', async () => {
                    const exConfig = this.exceptionsConfig[routeId] || {};
                    const exportStr = exConfig.gearset?.export_string;
                    if (!exportStr) return;
                    try {
                        await navigator.clipboard.writeText(exportStr);
                        if (window.api) window.api.showSuccess('Export string copied to clipboard.');
                    } catch (err) {
                        if (window.api) window.api.showError('Failed to copy to clipboard.');
                    }
                });
            }

            // Clear button
            const clearBtn = entry.querySelector('.travel-exception-clear-btn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (this.exceptionsConfig[routeId]) {
                        this.exceptionsConfig[routeId].gearset = {};
                        this.onExceptionConfigChange(routeId, 'gearset', {});
                    }
                    this._render();
                });
            }

            // Gear preview toggle
            const previewToggle = entry.querySelector('.travel-gear-preview-toggle');
            if (previewToggle) {
                previewToggle.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const previewEl = entry.querySelector('.travel-gear-preview');
                    if (!previewEl) return;

                    const isOpen = previewToggle.classList.contains('open');
                    if (isOpen) {
                        previewToggle.classList.remove('open');
                        previewEl.classList.remove('open');
                        return;
                    }

                    if (!previewEl.dataset.loaded) {
                        const exConfig = this.exceptionsConfig[routeId] || {};
                        const exportStr = exConfig.gearset?.export_string;
                        if (!exportStr) return;
                        try {
                            const html = await this._buildGearPreviewHtml(exportStr);
                            previewEl.innerHTML = html;
                            previewEl.dataset.loaded = '1';
                        } catch {
                            previewEl.innerHTML = '<span style="font-size:11px;color:var(--text-secondary)">Could not load gear</span>';
                        }
                    }

                    previewToggle.classList.add('open');
                    previewEl.classList.add('open');
                });
            }

            // Color picker for cross-region route
            const colorPicker = entry.querySelector('.travel-gearset-color-picker');
            if (colorPicker) {
                colorPicker.addEventListener('input', (e) => {
                    const color = e.target.value;
                    if (!this.exceptionsConfig[routeId]) this.exceptionsConfig[routeId] = { gearset: {} };
                    if (!this.exceptionsConfig[routeId].gearset) this.exceptionsConfig[routeId].gearset = {};
                    this.exceptionsConfig[routeId].gearset.color = color;
                    // Update swatch SVG fill live
                    const swatch = entry.querySelector('.travel-gearset-color-swatch');
                    if (swatch) {
                        swatch.querySelectorAll('[fill]').forEach(el => {
                            const fill = el.getAttribute('fill');
                            if (fill && fill !== 'none' && !fill.startsWith('rgba') && !fill.startsWith('#fff') && fill !== 'white') {
                                el.setAttribute('fill', color);
                            }
                        });
                    }
                    this.onRouteColorChange([routeId], color);
                });
                colorPicker.addEventListener('change', () => {
                    this.onExceptionConfigChange(routeId, 'gearset', this.exceptionsConfig[routeId]?.gearset || {});
                });
            }

        }

        // Advanced Edit button — convert current mode to advanced with groups
        const advEditBtn = this.el.querySelector('.travel-advanced-edit-btn'); if (advEditBtn) {
            advEditBtn.addEventListener('click', () => this._convertToAdvanced());
        }

        // Advanced mode: selection checkboxes
        const selectCbs = this.el.querySelectorAll('.travel-gearset-select-cb');
        console.log(`[TravelRegionCard:${this.region.id}] Found ${selectCbs.length} selection checkboxes`);
        for (const cb of selectCbs) {
            cb.addEventListener('change', (e) => {
                const slot = e.target.dataset.slot;
                if (e.target.checked) {
                    this._selectedSlots.add(slot);
                } else {
                    this._selectedSlots.delete(slot);
                }
                console.log(`[TravelRegionCard:${this.region.id}] Selection changed: slot = ${slot}, checked = ${e.target.checked}, total selected = ${this._selectedSlots.size} `);
                this._render();
            });
        }

        // Advanced mode: Group Selected button
        const groupBtn = this.el.querySelector('.travel-group-selected-btn');
        console.log(`[TravelRegionCard:${this.region.id}] Group Selected button found: ${!!groupBtn}, selectedSlots = ${this._selectedSlots.size} `);
        if (groupBtn) {
            groupBtn.addEventListener('click', () => {
                console.log(`[TravelRegionCard:${this.region.id}] Group Selected clicked, slots: ${[...this._selectedSlots].join(',')} `);
                this._groupSelected();
            });
        }

        // Advanced mode: Remove single route from group
        const removeBtns = this.el.querySelectorAll('.travel-group-route-remove');
        for (const btn of removeBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupKey = btn.dataset.groupKey;
                const slotKey = btn.dataset.slotKey;
                this._removeFromGroup(groupKey, slotKey);
            });
        }
    }

    // -------------------------------------------------------------------------
    // Optimize All & per-slot optimization — Req 4.11
    // -------------------------------------------------------------------------

    /**
     * Optimize All: trigger optimization for all empty RouteGearsets in this region.
     * Req 4.11: Each Region_Card SHALL display a single "Optimize All" button
     * that triggers Optimization_Tasks for all Route_Gearsets that do not yet
     * have an assigned gearset.
     */
    _onOptimizeAll() {
        const mode = this.regionConfig.mode || 'single';
        const gearsets = this.regionConfig.gearsets || {};
        const regionId = this.region.id;
        // Exclude cross-region exception routes — they're optimized separately
        const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
        const allRouteIds = this.routes.filter(r => !exIds.has(r.id)).map(r => r.id);

        if (mode === 'single') {
            if (!gearsets.single?.export_string) {
                this._triggerOptimize('single', 'single', allRouteIds);
            }
            return;
        }

        if (mode === 'long_short' || mode === 'multi') {
            // Multi mode: one task for the whole region
            const count = this.regionConfig.multi_count || 2;
            const taskKey = `${regionId}:multi`;
            this.onOptimize(taskKey, {
                task_key: taskKey,
                region_id: regionId,
                gearset_slot: 'multi',
                mode: mode,
                multi_count: count,
                route_ids: allRouteIds,
            });
            return;
        }

        if (mode === 'advanced') {
            for (let i = 0; i < this.routes.length; i++) {
                const slotKey = String(i + 1);
                if (gearsets[slotKey]?.export_string) continue;
                // Check grouped slots
                const groupKey = Object.keys(gearsets).find(k =>
                    k.includes(',') && k.split(',').includes(slotKey)
                );
                if (groupKey && gearsets[groupKey]?.export_string) continue;
                const actualSlot = groupKey || slotKey;
                const routeIds = groupKey
                    ? groupKey.split(',').map(k => this.routes[parseInt(k, 10) - 1]?.id).filter(Boolean)
                    : [this.routes[i].id];
                this._triggerOptimize(actualSlot, 'advanced', routeIds);
            }
            return;
        }

        if (mode === 'requirements') {
            const groups = this._getRequirementGroups();
            for (let i = 0; i < groups.length; i++) {
                const slotKey = `req_${i}`;
                if (gearsets[slotKey]?.export_string) continue;
                // Store short requirement label for naming the optimization result
                if (!gearsets[slotKey]) gearsets[slotKey] = {};
                gearsets[slotKey]._req_label = shortReqLabel(groups[i].reqs);
                const routeIds = groups[i].slotKeys.map(k => {
                    const route = this.routes[parseInt(k, 10) - 1];
                    return route?.id;
                }).filter(Boolean);
                this._triggerOptimize(slotKey, 'requirements', routeIds);
            }
            return;
        }
    }

    /**
     * Optimize a single gearset slot.
     * Called when the user clicks the Optimize button on an individual slot.
     * @param {string} slotKey - The slot key (e.g. 'single', '1', 'req_0', '1,2,3')
     */
    _onOptimizeSlot(slotKey) {
        const mode = this.regionConfig.mode || 'single';
        const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
        const allRouteIds = this.routes.filter(r => !exIds.has(r.id)).map(r => r.id);

        if (mode === 'single') {
            this._triggerOptimize('single', 'single', allRouteIds);
            return;
        }

        if (mode === 'long_short' || mode === 'multi') {
            // For multi modes, individual slot optimize triggers the whole region
            const count = this.regionConfig.multi_count || 2;
            const regionId = this.region.id;
            const taskKey = `${regionId}:multi`;
            this.onOptimize(taskKey, {
                task_key: taskKey,
                region_id: regionId,
                gearset_slot: 'multi',
                mode: mode,
                multi_count: count,
                route_ids: allRouteIds,
            });
            return;
        }

        // Advanced or requirements mode: optimize just this slot
        if (mode === 'requirements' && slotKey.startsWith('req_')) {
            const groups = this._getRequirementGroups();
            const idx = parseInt(slotKey.replace('req_', ''), 10);
            if (groups[idx]) {
                const gearsets = this.regionConfig.gearsets || {};
                if (!gearsets[slotKey]) gearsets[slotKey] = {};
                gearsets[slotKey]._req_label = shortReqLabel(groups[idx].reqs);
            }
        }
        const routeIds = this._getRouteIdsForSlot(slotKey);
        this._triggerOptimize(slotKey, mode, routeIds);
    }

    /**
     * Trigger an optimization task via the parent callback.
     * @param {string} slotKey
     * @param {string} mode
     * @param {string[]} routeIds
     */
    _triggerOptimize(slotKey, mode, routeIds) {
        const regionId = this.region.id;
        const taskKey = `${regionId}:${slotKey}`;

        // Store route names for result naming (advanced/single modes)
        if (mode === 'advanced' || mode === 'single') {
            if (!this.regionConfig.gearsets) this.regionConfig.gearsets = {};
            if (!this.regionConfig.gearsets[slotKey]) this.regionConfig.gearsets[slotKey] = {};
            const names = routeIds.map(rid => {
                const route = this.routes.find(r => r.id === rid);
                return route ? route.name : null;
            }).filter(Boolean);
            this.regionConfig.gearsets[slotKey].route_names = names;
        }

        this.onOptimize(taskKey, {
            task_key: taskKey,
            region_id: regionId,
            gearset_slot: slotKey,
            mode: mode,
            route_ids: routeIds,
        });
    }

    // -------------------------------------------------------------------------
    // Reset Region — two-click confirmation
    // -------------------------------------------------------------------------

    _onResetClick(btn) {
        if (this._resetPending) {
            this._resetPending = false;
            clearTimeout(this._resetTimer);
            btn.textContent = 'Reset Region';
            btn.classList.remove('confirm');
            this._executeReset();
        } else {
            this._resetPending = true;
            btn.textContent = 'Are you sure?';
            btn.classList.add('confirm');
            this._resetTimer = setTimeout(() => {
                this._resetPending = false;
                btn.textContent = 'Reset Region';
                btn.classList.remove('confirm');
            }, 3000);
        }
    }

    _executeReset() {
        this.regionConfig.gearsets = {};
        this.regionConfig.breakpoint = null;
        this._selectedSlots.clear();
        this._expandedGroups.clear();
        this.onConfigChange('gearsets', {});
        this.onConfigChange('breakpoint', null);
        // Also reset cross-region route gearsets for this region
        for (const exRoute of (this.exceptionRoutes || [])) {
            if (this.exceptionsConfig[exRoute.id]) {
                this.exceptionsConfig[exRoute.id].gearset = {};
                this.onExceptionConfigChange(exRoute.id, 'gearset', {});
            }
        }
        // Reset map route colors back to faction default
        // Cross-region routes (one-way, forward) use destination region color
        const DEST_COLORS = {
            jarvonia: '#bbdefa', trellin: '#a0e870', erdwise: '#fec08d',
            halfling_rebels: '#b8c375', syrenthia: '#c7b6fc',
            wallisia: '#e8a060', wrentmark: '#f0d080',
        };
        const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
        const sameRegionIds = [];
        for (const route of this.routes) {
            if (exIds.has(route.id)) continue;
            if (route._oneWay && !route._isReverse) {
                // Forward cross-region route: look up destination region from location name
                const parts = (route.name || '').split(' to ');
                if (parts.length === 2) {
                    const toRegion = LOCATION_CANONICAL_REGION[parts[1].trim()];
                    if (toRegion && toRegion !== this.region.id) {
                        const destColor = DEST_COLORS[toRegion] || '#888';
                        this.onRouteColorChange([route.id], destColor);
                        continue;
                    }
                }
            }
            sameRegionIds.push(route.id);
        }
        if (sameRegionIds.length) this.onRouteColorChange(sameRegionIds, this.region.color || '#888');
        // Reset exception route colors to destination region defaults
        for (const exRoute of (this.exceptionRoutes || [])) {
            const destColor = DEST_COLORS[exRoute.toRegion] || '#888';
            this.onRouteColorChange([exRoute.id], destColor);
        }
        this._render();
    }

    // -------------------------------------------------------------------------
    // Advanced mode — Grouping / Ungrouping (Req 4.12, 4.13, 4.14)
    // -------------------------------------------------------------------------

    /**
     * Merge selected individual slots into a single grouped entry.
     * The grouped entry key is the comma-joined sorted slot keys (e.g. "1,3,5").
     * Clears any existing gearset data since the group needs re-optimization.
     */
    _groupSelected() {
        if (this._selectedSlots.size < 2) return;

        const gearsets = this.regionConfig.gearsets || {};
        if (!this.regionConfig.gearsets) this.regionConfig.gearsets = {};

        // Collect all individual slot keys from selected items
        // (expand any selected groups into their constituent slots)
        const allSlotKeys = [];
        const allRouteNames = [];
        const allRouteIds = [];
        const groupsToRemove = [];

        for (const selected of this._selectedSlots) {
            const gs = gearsets[selected];
            if (gs && gs.grouped) {
                // This is a group — expand it
                const subKeys = selected.split(',');
                const subNames = gs.route_names || [];
                const subIds = gs.route_ids || [];
                for (let i = 0; i < subKeys.length; i++) {
                    allSlotKeys.push(subKeys[i]);
                    allRouteNames.push(subNames[i] || this._getRouteDisplayNamePlain(parseInt(subKeys[i], 10) - 1));
                    if (subIds[i]) allRouteIds.push(subIds[i]);
                }
                groupsToRemove.push(selected);
            } else {
                // Individual slot
                const slotIndex = parseInt(selected, 10) - 1;
                const route = this.routes[slotIndex];
                allSlotKeys.push(selected);
                allRouteNames.push(
                    (gs && gs.route_names && gs.route_names[0]) ||
                    (route ? route.name.replace(' to ', ' ⟷ ') : `${this.region.name} ${selected} `)
                );
                if (gs && gs.route_ids) allRouteIds.push(...gs.route_ids);
                else if (route && route.id) allRouteIds.push(route.id);
            }
        }

        // Deduplicate and sort
        const uniqueKeys = [...new Set(allSlotKeys)].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        const groupKey = uniqueKeys.join(',');

        // Build group name
        let groupName;
        if (allRouteNames.length <= 3) {
            groupName = allRouteNames.join(', ');
        } else {
            groupName = `${allRouteNames.slice(0, 2).join(', ')} (+${allRouteNames.length - 2} more)`;
        }

        // Create the merged group
        this.regionConfig.gearsets[groupKey] = {
            grouped: true,
            name: groupName,
            color: this.region.color,
            export_string: null,
            id: null,
            route_names: allRouteNames,
            route_ids: allRouteIds,
            stats: null,
        };

        // Remove old entries (individual slots and consumed groups)
        for (const key of this._selectedSlots) {
            delete this.regionConfig.gearsets[key];
        }
        for (const gk of groupsToRemove) {
            this._expandedGroups.delete(gk);
        }

        this._selectedSlots.clear();
        this.onConfigChange('gearsets', this.regionConfig.gearsets);
        this._render();
    }

    /**
     * Remove a single route from a group, restoring it as an individual slot.
     * If only one route remains, the group is fully dissolved.
     * @param {string} groupKey - Comma-separated slot keys
     * @param {string} slotKey - The individual slot key to remove
     */
    _removeFromGroup(groupKey, slotKey) {
        if (!this.regionConfig.gearsets) return;
        const groupData = this.regionConfig.gearsets[groupKey];
        if (!groupData || !groupData.grouped) return;

        const slotKeys = groupKey.split(',');
        const idx = slotKeys.indexOf(slotKey);
        if (idx === -1) return;

        const routeNames = groupData.route_names || [];
        const routeIds = groupData.route_ids || [];

        // Restore the removed slot as individual
        const slotIndex = parseInt(slotKey, 10) - 1;
        const route = this.routes[slotIndex];
        this.regionConfig.gearsets[slotKey] = {
            name: routeNames[idx] || (route ? route.name.replace(' to ', ' ⟷ ') : `${this.region.name} ${slotKey} `),
            color: this.region.color,
            export_string: null,
            id: null,
            route_names: routeNames[idx] ? [routeNames[idx]] : [],
            route_ids: routeIds[idx] ? [routeIds[idx]] : [],
            stats: null,
        };

        // Remove from group arrays
        const newSlotKeys = slotKeys.filter(k => k !== slotKey);
        const newRouteNames = routeNames.filter((_, i) => i !== idx);
        const newRouteIds = routeIds.filter((_, i) => i !== idx);

        // Delete old group entry
        delete this.regionConfig.gearsets[groupKey];
        this._expandedGroups.delete(groupKey);

        // If 2+ remain, create new group with updated key
        if (newSlotKeys.length >= 2) {
            const newGroupKey = newSlotKeys.join(',');
            let newName;
            if (newRouteNames.length <= 3) {
                newName = newRouteNames.join(', ');
            } else {
                newName = `${newRouteNames.slice(0, 2).join(', ')} (+${newRouteNames.length - 2} more)`;
            }
            this.regionConfig.gearsets[newGroupKey] = {
                grouped: true,
                name: newName,
                color: this.region.color,
                export_string: null,
                id: null,
                route_names: newRouteNames,
                route_ids: newRouteIds,
                stats: null,
            };
            this._expandedGroups.add(newGroupKey);
        } else if (newSlotKeys.length === 1) {
            // Only one left — dissolve to individual
            const lastKey = newSlotKeys[0];
            const lastIndex = parseInt(lastKey, 10) - 1;
            const lastRoute = this.routes[lastIndex];
            this.regionConfig.gearsets[lastKey] = {
                name: newRouteNames[0] || (lastRoute ? lastRoute.name.replace(' to ', ' ⟷ ') : `${this.region.name} ${lastKey} `),
                color: this.region.color,
                export_string: null,
                id: null,
                route_names: newRouteNames[0] ? [newRouteNames[0]] : [],
                route_ids: newRouteIds[0] ? [newRouteIds[0]] : [],
                stats: null,
            };
        }

        this.onConfigChange('gearsets', this.regionConfig.gearsets);
        this._render();
    }

    /**
     * Ungroup a grouped entry entirely, restoring all individual RouteGearset slots.
     * @param {string} groupKey - Comma-separated slot keys
     */
    _ungroupEntry(groupKey) {
        if (!this.regionConfig.gearsets) return;

        const groupData = this.regionConfig.gearsets[groupKey];
        if (!groupData || !groupData.grouped) return;

        const slotKeys = groupKey.split(',');
        const groupRouteNames = groupData.route_names || [];
        const groupRouteIds = groupData.route_ids || [];

        // Restore individual entries
        for (let i = 0; i < slotKeys.length; i++) {
            const key = slotKeys[i];
            this.regionConfig.gearsets[key] = {
                name: groupRouteNames[i] || `${this.region.name} ${key} `,
                color: this.region.color,
                export_string: null,
                id: null,
                route_names: groupRouteNames[i] ? [groupRouteNames[i]] : [],
                route_ids: groupRouteIds[i] ? [groupRouteIds[i]] : [],
                stats: null,
            };
        }

        // Remove the grouped entry
        delete this.regionConfig.gearsets[groupKey];

        this.onConfigChange('gearsets', this.regionConfig.gearsets);
        this._render();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Return the number of RouteGearset slots for the current mode.
     */
    _getGearsetCount() {
        const mode = this.regionConfig.mode || 'single';
        switch (mode) {
            case 'single': return 1;
            case 'multi': return this.regionConfig.multi_count || 2;
            case 'requirements': return this._getRequirementGroups().length;
            case 'advanced': return this.routeCount;
            default: return 1;
        }
    }

    /**
     * Get a display name for a route by its index in this region's route list.
     * Returns HTML with location icons and ⟷ arrow.
     * @param {number} index - 0-based index into this.routes
     * @returns {string} HTML string
     */
    _getRouteDisplayName(index) {
        const route = this.routes[index];
        if (!route) return `${this.region.name} ${index + 1}`;

        const name = route.name || '';
        const parts = name.split(' to ');
        if (parts.length === 2) {
            let a = parts[0].trim();
            let b = parts[1].trim();
            const aIcon = this._locationIconHtml(a);
            const bIcon = this._locationIconHtml(b);
            // One-way routes keep direction; bidirectional routes sort alphabetically
            if (route._oneWay) {
                return `${aIcon}${this._escapeHtml(a)} → ${bIcon}${this._escapeHtml(b)}`;
            }
            if (a.localeCompare(b) > 0) { [a, b] = [b, a]; }
            return `${this._locationIconHtml(a)}${this._escapeHtml(a)} ⟷ ${this._locationIconHtml(b)}${this._escapeHtml(b)}`;
        }
        return this._escapeHtml(name || `${this.region.name} ${index + 1}`);
    }

    /**
     * Get a small inline icon for a location name.
     * @param {string} locationName
     * @returns {string} HTML img tag or empty string
     */
    _locationIconHtml(locationName) {
        const iconBase = this.locationIcons[locationName];
        if (!iconBase) return '';
        return `<img src="/assets/icons/locations/${iconBase}_icon.svg" class="travel-route-loc-icon" alt="" onerror="this.style.display='none'" />`;
    }

    /**
     * Get terrain requirements for a route by index.
     * @param {number} index - 0-based index into this.routes
     * @returns {string[]} Array of requirement strings, empty if none
     */
    _getRouteRequirements(index) {
        const route = this.routes[index];
        if (!route) return [];
        return filterGearsetRequirements(route.terrainModifiers);
    }

    /**
     * Get a plain-text route display name (no HTML icons).
     * Used for group names stored in config.
     * @param {number} index
     * @returns {string}
     */
    _getRouteDisplayNamePlain(index) {
        const route = this.routes[index];
        if (!route) return `${this.region.name} ${index + 1}`;
        const name = route.name || '';
        const parts = name.split(' to ');
        if (parts.length === 2) {
            let a = parts[0].trim();
            let b = parts[1].trim();
            if (route._oneWay) {
                return `${a} → ${b}`;
            }
            if (a.localeCompare(b) > 0) { [a, b] = [b, a]; }
            return `${a} ⟷ ${b}`;
        }
        return name || `${this.region.name} ${index + 1}`;
    }

    /**
     * Push the current gearset colors to the map for all routes in this region.
     * Called after mode change or enable/disable to sync map colors.
     */
    _pushDefaultColors() {
        if (!this.regionConfig.enabled) return;
        const color = this.region.color;
        const allRouteIds = this.routes.map(r => r.id);
        if (allRouteIds.length) this.onRouteColorChange(allRouteIds, color);
    }

    /**
     * Live-filter advanced mode slots by search text.
     * Shows/hides DOM elements without re-rendering.
     * Groups are shown if ANY route in the group matches.
     * @param {string} text - Search text (case-insensitive)
     */
    _applyAdvancedSearch(text) {
        const query = text.toLowerCase().trim();
        const slots = this.el.querySelectorAll('.travel-gearset-slots > .travel-gearset-slot');

        for (const slot of slots) {
            const slotKey = slot.dataset.slot || '';
            const isGroup = slot.classList.contains('travel-gearset-slot--grouped');

            if (!query) {
                slot.style.display = '';
                continue;
            }

            if (isGroup) {
                // Show group if any constituent route name matches
                const keys = slotKey.split(',');
                const anyMatch = keys.some(k => {
                    const idx = parseInt(k, 10) - 1;
                    const name = this._getRouteDisplayNamePlain(idx);
                    return name.toLowerCase().includes(query);
                });
                slot.style.display = anyMatch ? '' : 'none';
            } else {
                // Individual slot — match against route name
                const idx = parseInt(slotKey, 10) - 1;
                const name = this._getRouteDisplayNamePlain(idx);
                const nameEl = slot.querySelector('.travel-gearset-name');
                const nameText = nameEl ? nameEl.textContent : '';
                const matches = name.toLowerCase().includes(query) || nameText.toLowerCase().includes(query);
                slot.style.display = matches ? '' : 'none';
            }
        }
    }


    /**
     * Get the route IDs affected by a gearset slot.
     */
    _getRouteIdsForSlot(slotKey) {
        const mode = this.regionConfig.mode || 'single';

        // Helper: resolve route ID (reverse routes use _originalId for map operations)
        const resolveId = (route) => route?._originalId || route?.id;

        if (slotKey === 'single') {
            // Exclude cross-region exception routes — they're optimized separately
            const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
            return this.routes.filter(r => !exIds.has(r.id)).map(r => resolveId(r)).filter(Boolean);
        }

        // For multi mode, the slot keys are "1", "2", etc. but they represent gearset groups,
        // NOT route indices. Use the stored route_ids from the config.
        if (mode === 'multi' || mode === 'long_short') {
            const gs = this.regionConfig.gearsets?.[slotKey];
            if (gs?.route_ids?.length) return gs.route_ids;
            // Fallback: if no route_ids yet (pre-optimization), return all routes
            return this.routes.map(r => resolveId(r)).filter(Boolean);
        }

        if (slotKey.startsWith('req_')) {
            const idx = parseInt(slotKey.replace('req_', ''), 10);
            const groups = this._getRequirementGroups();
            const group = groups[idx];
            if (group) {
                return group.slotKeys.map(k => {
                    const route = this.routes[parseInt(k, 10) - 1];
                    return resolveId(route);
                }).filter(Boolean);
            }
            return [];
        }

        if (slotKey.includes(',')) {
            return slotKey.split(',').map(k => {
                const route = this.routes[parseInt(k, 10) - 1];
                return resolveId(route);
            }).filter(Boolean);
        }

        // Individual slot index (advanced mode)
        const route = this.routes[parseInt(slotKey, 10) - 1];
        return route ? [resolveId(route)] : [];
    }

    /**
     * Group routes by their terrain requirements.
     * Returns an array of { key, label, slotKeys, routeNames, reqs } objects.
     * Routes with no requirements go into a "No requirements" group.
     */
    _getRequirementGroups() {
        const groups = {};
        for (let i = 0; i < this.routes.length; i++) {
            const route = this.routes[i];
            const reqs = filterGearsetRequirements(route.terrainModifiers).slice().sort();
            const key = reqs.length ? reqs.join(' | ') : '__none__';
            if (!groups[key]) {
                groups[key] = {
                    key,
                    label: reqs.length ? reqs.join(', ') : 'No special requirements',
                    slotKeys: [],
                    routeNames: [],
                    reqs,
                };
            }
            groups[key].slotKeys.push(String(i + 1));
            groups[key].routeNames.push(this._getRouteDisplayNamePlain(i));
        }
        // Sort: "no requirements" first, then by requirement text
        const sorted = Object.values(groups).sort((a, b) => {
            if (a.key === '__none__') return -1;
            if (b.key === '__none__') return 1;
            return a.label.localeCompare(b.label);
        });
        return sorted;
    }

    /**
     * Convert current mode's gearset assignments into advanced mode groups.
     * Used by the "Advanced Edit" button.
     */
    _convertToAdvanced() {
        const mode = this.regionConfig.mode || 'single';
        const gearsets = this.regionConfig.gearsets || {};

        // Build groups based on current mode
        const newGearsets = {};

        if (mode === 'requirements') {
            const reqGroups = this._getRequirementGroups();
            for (const group of reqGroups) {
                if (group.slotKeys.length === 1) {
                    // Single route — individual slot
                    const sk = group.slotKeys[0];
                    newGearsets[sk] = {
                        name: group.routeNames[0],
                        color: this.region.color,
                        export_string: null,
                        id: null,
                        route_names: group.routeNames,
                        route_ids: [],
                        stats: null,
                    };
                } else {
                    // Multiple routes — create group
                    const groupKey = group.slotKeys.join(',');
                    let groupName;
                    if (group.routeNames.length <= 3) {
                        groupName = group.routeNames.join(', ');
                    } else {
                        groupName = `${group.routeNames.slice(0, 2).join(', ')} (+${group.routeNames.length - 2} more)`;
                    }
                    newGearsets[groupKey] = {
                        grouped: true,
                        name: groupName,
                        color: this.region.color,
                        export_string: null,
                        id: null,
                        route_names: group.routeNames,
                        route_ids: [],
                        stats: null,
                    };
                }
            }
        } else if (mode === 'long_short' || mode === 'multi') {
            // Each numbered gearset becomes a group of its assigned routes
            // Map route_ids back to route indices for advanced mode slot keys
            for (const [slotKey, gs] of Object.entries(gearsets)) {
                if (slotKey.startsWith('_')) continue; // Skip internal keys
                if (!gs.route_ids || !gs.route_ids.length) continue;

                // Convert route IDs to 1-based route indices
                const slotKeys = [];
                const routeNames = [];
                for (const rid of gs.route_ids) {
                    const idx = this.routes.findIndex(r => r.id === rid);
                    if (idx >= 0) {
                        slotKeys.push(String(idx + 1));
                        routeNames.push(this.routes[idx].name || `Route ${idx + 1} `);
                    }
                }

                if (slotKeys.length === 0) continue;

                if (slotKeys.length === 1) {
                    // Single route — individual slot
                    newGearsets[slotKeys[0]] = {
                        name: routeNames[0],
                        color: gs.color || this.region.color,
                        export_string: gs.export_string,
                        id: gs.id,
                        route_names: routeNames,
                        route_ids: gs.route_ids,
                        stats: gs.stats,
                    };
                } else {
                    // Multiple routes — create group with comma-separated slot keys
                    const groupKey = slotKeys.join(',');
                    const groupName = routeNames.length <= 3
                        ? routeNames.join(', ')
                        : `${routeNames.slice(0, 2).join(', ')} (+${routeNames.length - 2} more)`;
                    newGearsets[groupKey] = {
                        grouped: true,
                        name: gs.name || groupName,
                        color: gs.color || this.region.color,
                        export_string: gs.export_string,
                        id: gs.id,
                        route_names: routeNames,
                        route_ids: gs.route_ids,
                        stats: gs.stats,
                    };
                }
            }
        } else if (mode === 'single') {
            // Single → advanced: one group with all routes (excluding cross-region)
            const singleGs = gearsets.single || {};
            const exIds = new Set((this.exceptionRoutes || []).map(ex => ex.id));
            const filteredRoutes = this.routes
                .map((r, i) => ({ route: r, index: i }))
                .filter(({ route }) => !exIds.has(route.id));
            if (singleGs.export_string && filteredRoutes.length) {
                const allSlotKeys = filteredRoutes.map(({ index }) => String(index + 1));
                const allRouteNames = filteredRoutes.map(({ route }) => route.name);
                const allRouteIds = filteredRoutes.map(({ route }) => route.id);
                const groupKey = allSlotKeys.join(',');
                newGearsets[groupKey] = {
                    grouped: true,
                    name: singleGs.name || this.region.name,
                    color: singleGs.color || this.region.color,
                    export_string: singleGs.export_string,
                    id: singleGs.id,
                    route_names: allRouteNames,
                    route_ids: singleGs.route_ids || allRouteIds,
                    stats: singleGs.stats,
                };
            }
        }

        // Switch to advanced mode with the converted gearsets
        this.regionConfig.mode = 'advanced';
        if (Object.keys(newGearsets).length > 0) {
            this.regionConfig.gearsets = newGearsets;
        }
        this._selectedSlots.clear();
        this._expandedGroups.clear();
        this.onConfigChange('mode', 'advanced');
        this.onConfigChange('gearsets', this.regionConfig.gearsets);
        this._render();

        // Push colors to map for each advanced slot
        for (const [slotKey, gs] of Object.entries(this.regionConfig.gearsets || {})) {
            const routeIds = gs.route_ids?.length ? gs.route_ids : this._getRouteIdsForSlot(slotKey);
            if (routeIds.length) {
                this.onRouteColorChange(routeIds, gs.color || this.region.color);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Re-render with current config */
    refresh() {
        this._render();
        // Trigger validation for all assigned gearsets after re-render
        this._validateAllAssignedGearsets();
    }

    /** Update region config and re-render */
    setRegionConfig(config) {
        this.regionConfig = config;
        this._render();
        // Trigger validation for all assigned gearsets after config update
        this._validateAllAssignedGearsets();
    }

    /** Update exceptions config and re-render (for inline exception route updates) */
    setExceptionsConfig(config) {
        this.exceptionsConfig = config;
    }

    // -------------------------------------------------------------------------
    // Optimization loading state
    // -------------------------------------------------------------------------

    /**
     * Mark a slot as optimizing — shows spinner on its button and locks the card.
     * Called by the parent (ConfigPanel / TravelConfigPage) when an optimization starts.
     * @param {string} slotKey
     */
    setSlotOptimizing(slotKey) {
        this._optimizingSlots.add(slotKey);
        // For multi mode, the task key is 'multi' but slots are numbered '1', '2', etc.
        if (slotKey === 'multi') {
            const mode = this.regionConfig.mode || 'single';
            const count = this.regionConfig.multi_count || 2;
            for (let i = 1; i <= count; i++) {
                this._updateOptimizeButtonState(String(i), true);
            }
        } else {
            this._updateOptimizeButtonState(slotKey, true);
        }
        this._updateCardLock();
    }

    /**
     * Clear optimizing state for a slot.
     * @param {string} slotKey
     */
    clearSlotOptimizing(slotKey) {
        this._optimizingSlots.delete(slotKey);
        if (slotKey === 'multi') {
            const count = this.regionConfig.multi_count || 2;
            for (let i = 1; i <= count; i++) {
                this._updateOptimizeButtonState(String(i), false);
            }
        } else {
            this._updateOptimizeButtonState(slotKey, false);
        }
        this._updateCardLock();
    }

    /** Update a single optimize button to show/hide spinner without full re-render. */
    _updateOptimizeButtonState(slotKey, isOptimizing) {
        const slot = this.el.querySelector(`.travel-gearset-slot[data-slot="${slotKey}"]`);
        if (!slot) return;
        const btn = slot.querySelector('.travel-gearset-optimize-btn');
        if (!btn) return;
        if (isOptimizing) {
            btn.disabled = true;
            btn.classList.add('optimizing');
            btn.innerHTML = '<span class="travel-opt-spinner">⏳</span> Optimizing…';
        } else {
            btn.disabled = false;
            btn.classList.remove('optimizing');
            btn.textContent = 'Optimize';
        }
    }

    /** Lock/unlock the card controls while any slot is optimizing. */
    _updateCardLock() {
        const locked = this._optimizingSlots.size > 0;
        const modeSelect = this.el.querySelector('.travel-mode-select');
        if (modeSelect) modeSelect.disabled = locked;
        const enableCb = this.el.querySelector('.travel-region-enable-cb');
        if (enableCb) enableCb.disabled = locked;
        const resetBtn = this.el.querySelector('.travel-region-reset-btn');
        if (resetBtn) resetBtn.disabled = locked;
        const headerResetBtn = this.el.querySelector('.travel-region-header-reset-btn');
        if (headerResetBtn) headerResetBtn.disabled = locked;
        const slider = this.el.querySelector('.travel-multi-slider-input');
        if (slider) slider.disabled = locked;
        const optimizeAllBtn = this.el.querySelector('.travel-optimize-all-btn');
        if (optimizeAllBtn) {
            optimizeAllBtn.disabled = locked;
            if (locked) {
                optimizeAllBtn.innerHTML = '<span class="travel-opt-spinner">⏳</span> Optimizing…';
            } else {
                optimizeAllBtn.textContent = '▶ Optimize All';
            }
        }
        // Disable all action buttons inside gearset slots
        const actionBtns = this.el.querySelectorAll(
            '.travel-gearset-select-btn, .travel-gearset-import-btn, ' +
            '.travel-gearset-equip-btn, .travel-gearset-export-btn, ' +
            '.travel-gearset-clear-btn, .travel-advanced-edit-btn'
        );
        for (const btn of actionBtns) btn.disabled = locked;
    }

    /**
     * Validate terrain requirements for a specific gearset slot.
     * Calls the backend validation endpoint and stores warnings on the gearset config.
     * Req 9.1: Evaluate terrain requirements immediately after gearset is assigned or imported.
     * Req 9.2-9.4: Show specific warnings for skis, diving gear, light sources.
     * Req 9.6: Update Route_Status on the map.
     * @param {string} slotKey - The gearset slot key (e.g. 'single', '1', '2')
     */
    async validateGearsetSlot(slotKey) {
        const gearset = this.regionConfig.gearsets?.[slotKey];
        if (!gearset?.export_string) return;

        const routeIds = this._getRouteIdsForSlot(slotKey);
        if (!routeIds.length) return;

        const hadStats = gearset.stats && gearset.stats.we != null;

        try {
            const resp = await fetch('/api/travel-config/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    export_string: gearset.export_string,
                    route_ids: routeIds,
                }),
            });

            if (!resp.ok) return;
            const data = await resp.json();
            if (!data.success) return;

            // Collect warnings and update requirements_met
            const warnings = [];
            let allMet = true;
            const routeStatuses = {};

            for (const [routeId, result] of Object.entries(data.results || {})) {
                if (!result.met) {
                    allMet = false;
                    for (const msg of (result.missing || [])) {
                        if (!warnings.includes(msg)) warnings.push(msg);
                    }
                    routeStatuses[routeId] = 'assigned_unmet';
                } else {
                    routeStatuses[routeId] = 'assigned_met';
                }
            }

            // Store warnings on the gearset config for rendering
            gearset._validation_warnings = warnings;
            if (gearset.stats) {
                gearset.stats.requirements_met = allMet;
            } else {
                gearset.stats = { requirements_met: allMet };
            }

            // Apply travel stats from validate response (WE, DA, steps, etc.)
            if (data.stats) {
                gearset.stats.we = data.stats.we ?? gearset.stats.we;
                gearset.stats.da = data.stats.da ?? gearset.stats.da;
                gearset.stats.steps_add = data.stats.steps_add ?? gearset.stats.steps_add;
                gearset.stats.steps_percent = data.stats.steps_percent ?? gearset.stats.steps_percent;
            }

            // Update the warnings display in-place without full re-render
            const slotEl = this.el?.querySelector(`.travel-gearset-slot[data-slot="${slotKey}"]`);
            if (slotEl) {
                const body = slotEl.querySelector('.travel-gearset-slot-body');
                if (body) {
                    // Update warnings area
                    const existing = body.querySelector('.travel-gearset-warnings');
                    const warningsHtml = warnings.length
                        ? `<div class="travel-gearset-warnings">${warnings.map(w => `<div class="travel-gearset-warning-item">${this._getWarningIcon(w)} ${this._escapeHtml(w)}</div>`).join('')}</div>`
                        : '';
                    if (existing) {
                        if (warningsHtml) {
                            existing.outerHTML = warningsHtml;
                        } else {
                            existing.remove();
                        }
                    } else if (warningsHtml) {
                        const statsRow = body.querySelector('.travel-gearset-stats');
                        if (statsRow) statsRow.insertAdjacentHTML('afterend', warningsHtml);
                    }

                    // Update requirements indicator
                    const reqsSpan = body.querySelector('.travel-reqs-met, .travel-reqs-unmet');
                    if (reqsSpan) {
                        reqsSpan.className = `travel - gearset - stat ${allMet ? 'travel-reqs-met' : 'travel-reqs-unmet'} `;
                        reqsSpan.textContent = allMet ? '✓ Reqs' : '⚠ Reqs';
                    }
                }
            }

            // Store per-route validation statuses for reload
            gearset._route_statuses = routeStatuses;

            // Ensure route_ids is set (needed for _applyAllSavedColorsToMap on reload)
            if (!gearset.route_ids || !gearset.route_ids.length) {
                gearset.route_ids = routeIds;
            }

            // Notify parent to update map route statuses (Req 9.6)
            if (Object.keys(routeStatuses).length) {
                const color = gearset.color || this.region.color;
                const statusMap = {};
                for (const [routeId, status] of Object.entries(routeStatuses)) {
                    statusMap[routeId] = {
                        status: status,
                        color: color,
                        steps: null,
                    };
                }
                if (window.travelMap) {
                    window.travelMap.updateRouteStatuses(statusMap);
                }
            }

            // Persist validation results
            this.onConfigChange('gearsets', this.regionConfig.gearsets);

            // If stats were newly computed (e.g., from Select Existing), re-render to show them
            // Only re-render if stats were previously missing to avoid infinite render loops
            if (data.stats && (data.stats.we != null || data.stats.da != null) && !hadStats) {
                this._render();
            }
        } catch (err) {
            console.warn(`[RegionCard:${this.region.id}] Validation error for slot ${slotKey}: `, err);
        }
    }

    /**
     * Validate all assigned gearset slots in this region.
     * Called after render/refresh to ensure validation is up-to-date.
     * @private
     */
    _validateAllAssignedGearsets() {
        const gearsets = this.regionConfig.gearsets || {};
        for (const [slotKey, gs] of Object.entries(gearsets)) {
            if (gs?.export_string) {
                this.validateGearsetSlot(slotKey);
            }
        }
    }

    /**
     * Validate an exception route gearset and compute stats.
     * Calls the validate endpoint which returns both validation results and stats.
     * @param {string} routeId
     * @param {string} exportStr
     */
    async _validateExceptionSlot(routeId, exportStr) {
        try {
            const resp = await fetch('/api/travel-config/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    export_string: exportStr,
                    route_ids: [routeId],
                }),
            });
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data.success) return;

            const exCfg = this.exceptionsConfig[routeId];
            if (!exCfg?.gearset) return;
            const gs = exCfg.gearset;

            // Apply validation results
            const result = data.results?.[routeId];
            const allMet = result?.met !== false;
            gs._validation_warnings = result?.missing || [];
            if (!gs.stats) gs.stats = {};
            gs.stats.requirements_met = allMet;

            // Apply travel stats
            if (data.stats) {
                gs.stats.we = data.stats.we;
                gs.stats.da = data.stats.da;
                gs.stats.steps_add = data.stats.steps_add;
                gs.stats.steps_percent = data.stats.steps_percent;
            }

            this.onExceptionConfigChange(routeId, 'gearset', gs);
            this._render();
        } catch (err) {
            console.warn(`[RegionCard:${this.region.id}] Exception validation error for ${routeId}:`, err);
        }
    }

    /** Update exception routes and re-render */
    setExceptionRoutes(exceptionRoutes, exceptionsConfig) {
        this.exceptionRoutes = exceptionRoutes || [];
        this.exceptionsConfig = exceptionsConfig || {};
        this._render();
    }

    /** Get the current gearset count for this region */
    getGearsetCount() {
        return this._getGearsetCount();
    }

    /** Get the region definition */
    getRegion() {
        return this.region;
    }

    /** Get the current mode */
    getMode() {
        return this.regionConfig.mode || 'single';
    }

    /** Check if region is enabled */
    isEnabled() {
        return !!this.regionConfig.enabled;
    }

    destroy() {
        clearTimeout(this._resetTimer);
        this._selectedSlots.clear();
        this._expandedGroups.clear();
        if (this.el) this.el.innerHTML = '';
    }

    /**
     * Escape HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    /**
     * Decode a gearset export string and build the HTML for the gear preview.
     * Gear slots order: head, cape, back, chest, primary, secondary, hands, legs, neck, feet, ring1, ring2
     * Tools: tool0-tool5 (new line)
     */
    async _buildGearPreviewHtml(exportStr) {
        // Decode gearset
        let padded = exportStr;
        const padding = exportStr.length % 4;
        if (padding) padded += '='.repeat(4 - padding);
        const decoded = atob(padded);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        const decompressed = window.pako.inflate(bytes, { to: 'string' });
        const data = JSON.parse(decompressed);

        // Build slot → item map
        const slotMap = {};
        for (const entry of (data.items || [])) {
            const isMulti = entry.type === 'ring' || entry.type === 'tool';
            const key = isMulti ? `${entry.type}${entry.index}` : entry.type;
            try { slotMap[key] = JSON.parse(entry.item); } catch (_) { }
        }

        // Fetch catalog for icon/rarity lookup
        let catalogById = {};
        let catalogByUuid = {};
        let catalogByName = {};
        try {
            const resp = await window.api.getCatalog();
            for (const item of (resp.items || [])) {
                catalogById[item.id] = item;
                if (item.uuid) catalogByUuid[item.uuid] = item;
                if (item.name) catalogByName[item.name.toLowerCase()] = item;
            }
        } catch (_) { }

        // Quality name from export → CSS rarity class
        // Export uses: common, uncommon, rare, epic, legendary, ethereal
        const QUALITY_TO_RARITY = {
            common: 'rarity-common', uncommon: 'rarity-uncommon', rare: 'rarity-rare',
            epic: 'rarity-epic', legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
        };

        const renderSlot = (key) => {
            const entry = slotMap[key];
            if (!entry) return `<div class="travel-gear-mini-slot" title=""></div>`;
            // Look up by UUID first (gearset export uses UUIDs), fall back to id, then name
            const catalogItem = catalogByUuid[entry.id] || catalogById[entry.id] || {};
            // Use quality from export first (it's the rarity name: common/rare/etc.),
            // fall back to catalog rarity
            const qualityKey = (entry.quality || catalogItem.rarity || '').toLowerCase();
            const rarityClass = QUALITY_TO_RARITY[qualityKey] || '';
            const icon = catalogItem.icon_path || '';
            const name = catalogItem.name || entry.id || '';
            return `<div class="travel-gear-mini-slot ${rarityClass}" title="${name}">
                    ${icon ? `<img src="${icon}" alt="${name}" class="travel-gear-mini-icon" loading="lazy" />` : ''}
                </div>`;
        };

        const gearSlots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary', 'hands', 'legs', 'neck', 'feet', 'ring0', 'ring1'];
        const toolSlots = ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'];

        const gearHtml = gearSlots.map(renderSlot).join('');
        const toolHtml = toolSlots.map(renderSlot).join('');

        return `
                <div class="travel-gear-preview-row">${gearHtml}</div>
                <div class="travel-gear-preview-row tools-row">${toolHtml}</div>
            `;
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /** Convert "A to B" route name to "A ⟷ B" (bidirectional) or "A → B" (one-way). */
    _formatRouteName(name, oneWay = false) {
        if (!name) return '';
        const parts = name.split(' to ');
        if (parts.length === 2) {
            let a = parts[0].trim();
            let b = parts[1].trim();
            if (oneWay) return `${a} → ${b}`;
            if (a.localeCompare(b) > 0) { [a, b] = [b, a]; }
            return `${a} ⟷ ${b}`;
        }
        return name;
    }

    /**
     * Get an appropriate icon for a terrain requirement warning.
     * Req 9.2-9.5: Show specific warning text for each requirement type.
     * @param {string} warning
     * @returns {string} icon character
     * @private
     */
    _getWarningIcon(warning) {
        const w = warning.toLowerCase();
        if (w.includes('expert diving')) return '<img src="/assets/icons/keywords/expert_diving_gear.svg" class="travel-warning-kw-icon" alt="expert diving gear" />';
        if (w.includes('advanced diving')) return '<img src="/assets/icons/keywords/advanced_diving_gear.svg" class="travel-warning-kw-icon" alt="advanced diving gear" />';
        if (w.includes('diving')) return '<img src="/assets/icons/keywords/diving_gear.svg" class="travel-warning-kw-icon" alt="diving gear" />';
        if (w.includes('ski')) return '<img src="/assets/icons/keywords/skis.svg" class="travel-warning-kw-icon" alt="skis" />';
        if (w.includes('light')) return '<img src="/assets/icons/keywords/light_source.svg" class="travel-warning-kw-icon" alt="light source" />';
        if (w.includes('desert') || w.includes('navigate')) return '<img src="/assets/icons/keywords/desert_location.svg" class="travel-warning-kw-icon" alt="desert" />';
        return '⚠';
    }

    /**
     * Render a color swatch with hidden color picker input.
     * @param {string} color - Current hex color
     * @param {string} slotKey - The gearset slot key for identifying which swatch was clicked
     * @returns {string} HTML
     */
    _renderColorSwatch(color, slotKey) {
        const pickerId = `color-picker-${this.region.id}-${slotKey}`;
        // Spray paint can — white outlines, selected color fills, spray lines
        const canIcon = `<svg class="travel-swatch-icon" viewBox="0 0 44 50" width="28" height="32">` +
            // Can body (rounded bottom, 10% shorter)
            `<path d="M9 14 L9 43 Q9 47 13 47 L27 47 Q31 47 31 43 L31 14 Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
            // Shoulder
            `<path d="M9 14 Q9 11 13 10 L27 10 Q31 11 31 14" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
            // Label rectangle
            `<rect x="13" y="21" width="14" height="16" rx="1.5" fill="rgba(255,255,255,0.15)" stroke="#fff" stroke-width="1.2"/>` +
            // Label corner detail
            `<path d="M16 31 L16 34 L19 34" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/>` +
            // Cap dome
            `<path d="M13 10 Q13 5 20 4 Q27 5 27 10 Z" fill="${color}" stroke="#fff" stroke-width="1.3"/>` +
            // Nozzle
            `<rect x="18" y="2" width="4" height="3.5" rx="1" fill="${color}" stroke="#fff" stroke-width="1"/>` +
            // Spray cone: color fill, then white outline lines (top, middle, bottom)
            `<path d="M24 3.5 L40 -4 L42 3.5 L40 11 Z" fill="${color}" opacity="0.75"/>` +
            `<line x1="24" y1="3" x2="40" y2="-4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>` +
            `<line x1="24" y1="3.5" x2="42" y2="3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>` +
            `<line x1="24" y1="4" x2="40" y2="11" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>` +
            `</svg>`;
        return `<label class="travel-gearset-color-swatch-label" title="Click to change color">` +
            `<span class="travel-gearset-color-swatch" data-slot="${slotKey}">` +
            canIcon +
            `</span>` +
            `<input type="color" id="${pickerId}" class="travel-gearset-color-picker" value="${color}" data-slot="${slotKey}" aria-label="Pick gearset color" />` +
            `</label>`;
    }
}
