import { wireInfoIcons } from './info-popover.js';
import { showGearsetPicker } from './travel-gearset-picker.js';

import { formatFixed } from './utils/number-format.js';

/**
 * MovementActivitiesSection - Renders movement activity shortcuts for the Travel Config page.
 *
 * Movement activities (e.g., Run for Your Life, Explore Bog Bottom) act as
 * zero-detour edges between locations and require their own gearset optimization.
 *
 * Only shown for enabled regions. Each entry has:
 *   - Enable/disable checkbox
 *   - From/to locations and base step count
 *   - RouteGearset with Optimize/Import/Equip/Export buttons
 *
 * Ring of Homesickness toggle is shown only if the item is in the player's inventory.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

// ============================================================================
// KNOWN MOVEMENT ACTIVITIES
// ============================================================================

/**
 * Static list of known movement activities.
 * Each entry maps to a region so we can filter by enabled regions.
 * `id` matches the key used in Travel_Config_Store.movement_activities.
 */
const MOVEMENT_ACTIVITIES = [
    {
        id: 'run_for_your_life',
        name: 'Run for Your Life',
        from: 'Any Halfling Rebels location',
        to: 'Old Arena Ruins',
        baseSteps: 500,
        region: 'halfling_rebels',
        requirements: ['2 unique Light source equipped', 'Agility lvl. 35'],
    },
    {
        id: 'explore_bog_bottom',
        name: 'Explore Bog Bottom',
        from: 'Bog Bottom',
        to: 'Underwater Cave',
        baseSteps: 2500,
        region: 'halfling_rebels',
        requirements: ['Underwater map collectible', 'Mining lvl. 50'],
    },
    {
        id: 'explore_underwater_cave',
        name: 'Explore Underwater Cave',
        from: 'Underwater Cave',
        to: 'Bog Bottom',
        baseSteps: 2500,
        region: 'syrenthia',
        requirements: ['Underwater map collectible', 'Mining lvl. 50'],
    },
];

// ============================================================================
// MOVEMENTACTIVITIESSECTION CLASS
// ============================================================================

export default class MovementActivitiesSection {
    /**
     * @param {HTMLElement} element - Container element
     * @param {Object} opts
     * @param {Object}   opts.config          - Full Travel_Config_Store reference
     * @param {Object}   opts.enabledRegions  - { regionId: boolean } map of enabled regions
     * @param {boolean}  opts.hasRingOfHomesickness - Whether Ring of Homesickness is in inventory
     * @param {Function} opts.onConfigChange  - Called when any config value changes
     * @param {Function} opts.onOptimize      - Called with (taskKey, payload) to start optimization
     */
    constructor(element, opts = {}) {
        this.el = typeof element === 'string' ? document.querySelector(element) : element;
        this.config = opts.config || {};
        this.enabledRegions = opts.enabledRegions || {};
        this.hasRingOfHomesickness = opts.hasRingOfHomesickness || false;
        this.onConfigChange = opts.onConfigChange || (() => { });
        this.onOptimize = opts.onOptimize || (() => { });

        this._render();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _render() {
        if (!this.el) return;

        const movementConfig = this.config.movement_activities || {};
        const ringEnabled = this.config.ring_of_homesickness !== false;

        // Filter activities to only enabled regions (Req 7.3)
        const visibleActivities = MOVEMENT_ACTIVITIES.filter(
            act => this.enabledRegions[act.region]
        );

        let html = `
            <div class="travel-movement-section-header">
                <span class="travel-movement-section-title">Movement Activities</span>
                <span class="travel-info-icon"
                      data-info="Movement activities are special activities that act as shortcuts between locations and require their own gearset optimization."
                      role="button" tabindex="0" aria-label="Movement activities info">ⓘ</span>
            </div>
        `;

        if (visibleActivities.length === 0) {
            html += `<div class="travel-movement-empty">No movement activities available for enabled regions.</div>`;
        } else {
            html += '<div class="travel-movement-activities-list">';
            for (const act of visibleActivities) {
                html += this._renderActivity(act, movementConfig[act.id] || {});
            }
            html += '</div>';
        }

        // Ring of Homesickness toggle — only if item is in inventory (Req 7.7)
        if (this.hasRingOfHomesickness) {
            html += this._renderRingToggle(ringEnabled);
        }

        this.el.innerHTML = html;
        this._attachEvents();
    }

    _renderActivity(act, actConfig) {
        const enabled = actConfig.enabled !== false;
        const gearset = actConfig.gearset || {};
        const hasGearset = !!gearset.export_string;

        const we = gearset.stats?.we != null ? formatFixed(gearset.stats.we, 1) + '%' : '—';
        const da = gearset.stats?.da != null ? formatFixed(gearset.stats.da, 1) + '%' : '—';
        const reqsMet = gearset.stats?.requirements_met !== false;
        const reqsIcon = reqsMet ? '✓' : '⚠';
        const reqsClass = reqsMet ? 'travel-reqs-met' : 'travel-reqs-unmet';

        return `
            <div class="travel-movement-activity" data-activity-id="${this._escapeAttr(act.id)}">
                <div class="travel-movement-activity-header">
                    <label class="travel-movement-enable">
                        <input type="checkbox" class="travel-movement-enable-cb"
                               data-activity-id="${this._escapeAttr(act.id)}"
                               ${enabled ? 'checked' : ''} />
                    </label>
                    <div class="travel-movement-activity-info">
                        <span class="travel-movement-activity-name">${this._escapeHtml(act.name)}</span>
                        <span class="travel-movement-activity-route">${this._escapeHtml(act.from)} → ${this._escapeHtml(act.to)}</span>
                        <span class="travel-movement-activity-steps">${act.baseSteps} base steps</span>
                        ${act.requirements?.length ? `<span class="travel-movement-activity-reqs">${act.requirements.map(r => this._escapeHtml(r)).join(' · ')}</span>` : ''}
                    </div>
                </div>
                ${enabled ? `
                    <div class="travel-movement-gearset">
                        ${hasGearset ? `
                            <div class="travel-gearset-stats">
                                <span class="travel-gearset-stat">WE: ${we}</span>
                                <span class="travel-gearset-stat">DA: ${da}</span>
                                <span class="travel-gearset-stat ${reqsClass}">${reqsIcon} Reqs</span>
                            </div>
                        ` : `<div class="travel-gearset-empty">No gearset assigned</div>`}
                        <div class="travel-gearset-actions">
                            <button class="button button-primary travel-movement-optimize-btn"
                                    data-activity-id="${this._escapeAttr(act.id)}">Optimize</button>
                            <button class="button travel-movement-select-btn"
                                    data-activity-id="${this._escapeAttr(act.id)}">Select Existing</button>
                            <button class="button travel-movement-import-btn"
                                    data-activity-id="${this._escapeAttr(act.id)}">Import</button>
                            ${hasGearset ? `
                                <button class="button travel-movement-equip-btn"
                                        data-activity-id="${this._escapeAttr(act.id)}">Equip</button>
                                <button class="button travel-movement-export-btn"
                                        data-activity-id="${this._escapeAttr(act.id)}">Export</button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render the Ring of Homesickness toggle.
     * Only visible when the item is in the player's inventory (Req 7.7).
     */
    _renderRingToggle(enabled) {
        return `
            <div class="travel-ring-toggle">
                <label class="travel-ring-toggle-label">
                    <input type="checkbox" id="travel-ring-of-homesickness"
                           ${enabled ? 'checked' : ''} />
                    <span class="travel-ring-toggle-text">Ring of Homesickness</span>
                </label>
                <span class="travel-info-icon"
                      data-info="The Ring of Homesickness teleports you to Kallaheim at zero step cost. Enable this to allow the route planner to use it as a free edge."
                      role="button" tabindex="0" aria-label="Ring of Homesickness info">ⓘ</span>
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    _attachEvents() {
        // Enable/disable checkboxes for each activity (Req 7.4)
        const enableCbs = this.el.querySelectorAll('.travel-movement-enable-cb');
        for (const cb of enableCbs) {
            cb.addEventListener('change', (e) => {
                const actId = e.target.dataset.activityId;
                if (!actId) return;
                if (!this.config.movement_activities) this.config.movement_activities = {};
                if (!this.config.movement_activities[actId]) this.config.movement_activities[actId] = {};
                this.config.movement_activities[actId].enabled = e.target.checked;
                this.onConfigChange();
                this._render();
            });
        }

        // Optimize buttons (Req 7.6)
        const optBtns = this.el.querySelectorAll('.travel-movement-optimize-btn');
        for (const btn of optBtns) {
            btn.addEventListener('click', () => {
                const actId = btn.dataset.activityId;
                if (!actId) return;
                const act = MOVEMENT_ACTIVITIES.find(a => a.id === actId);
                if (!act) return;
                const taskKey = `movement:${actId}`;
                this.onOptimize(taskKey, {
                    task_key: taskKey,
                    region_id: act.region,
                    gearset_slot: actId,
                    mode: 'single',
                    route_ids: [],
                    activity_id: actId,
                });
            });
        }

        // Select Existing buttons
        const selectBtns = this.el.querySelectorAll('.travel-movement-select-btn');
        for (const btn of selectBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const actId = btn.dataset.activityId;
                if (!actId) return;

                showGearsetPicker(btn, (gs) => {
                    if (!this.config.movement_activities) this.config.movement_activities = {};
                    if (!this.config.movement_activities[actId]) this.config.movement_activities[actId] = {};
                    this.config.movement_activities[actId].gearset = {
                        export_string: gs.export_string || '__saved__',
                        saved_gearset_id: gs.id,
                        name: gs.name,
                        stats: null,
                    };
                    this.onConfigChange();
                    this._render();
                    if (window.api) window.api.showSuccess(`Loaded "${gs.name}"`);
                });
            });
        }

        // Equip buttons
        const equipBtns = this.el.querySelectorAll('.travel-movement-equip-btn');
        for (const btn of equipBtns) {
            btn.addEventListener('click', async () => {
                const actId = btn.dataset.activityId;
                if (!actId) return;
                const actConfig = (this.config.movement_activities || {})[actId] || {};
                const exportStr = actConfig.gearset?.export_string;
                if (!exportStr) return;
                try {
                    const { default: store } = await import('./state.js');
                    await store.loadGearSetFromExport(exportStr, null, actConfig.gearset?.name || actId);
                    if (window.api) window.api.showSuccess('Loaded movement activity gearset into Gear Stats.');
                } catch (err) {
                    if (window.api) window.api.showError('Failed to load gearset.');
                }
            });
        }

        // Export buttons
        const expBtns = this.el.querySelectorAll('.travel-movement-export-btn');
        for (const btn of expBtns) {
            btn.addEventListener('click', async () => {
                const actId = btn.dataset.activityId;
                if (!actId) return;
                const actConfig = (this.config.movement_activities || {})[actId] || {};
                const exportStr = actConfig.gearset?.export_string;
                if (!exportStr) return;
                try {
                    await navigator.clipboard.writeText(exportStr);
                    if (window.api) window.api.showSuccess('Export string copied to clipboard.');
                } catch (err) {
                    if (window.api) window.api.showError('Failed to copy to clipboard.');
                }
            });
        }

        // Ring of Homesickness toggle (Req 7.7)
        const ringCb = this.el.querySelector('#travel-ring-of-homesickness');
        if (ringCb) {
            ringCb.addEventListener('change', (e) => {
                this.config.ring_of_homesickness = e.target.checked;
                this.onConfigChange();
            });
        }

        wireInfoIcons(this.el);
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Update enabled regions and re-render.
     * @param {Object} enabledRegions - { regionId: boolean }
     */
    setEnabledRegions(enabledRegions) {
        this.enabledRegions = enabledRegions || {};
        this._render();
    }

    /**
     * Update Ring of Homesickness inventory status and re-render.
     * @param {boolean} hasRing
     */
    setHasRingOfHomesickness(hasRing) {
        this.hasRingOfHomesickness = !!hasRing;
        this._render();
    }

    /**
     * Update config reference and re-render.
     * @param {Object} config
     */
    setConfig(config) {
        this.config = config;
        this._render();
    }

    refresh() {
        this._render();
    }

    destroy() {
        if (this.el) this.el.innerHTML = '';
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

export { MOVEMENT_ACTIVITIES };
