import { formatFixed } from './utils/number-format.js';
/**
 * RouteGearset - A single gearset slot within a RegionCard.
 *
 * Handles four visual states:
 *   - empty:      placeholder indicating no gearset assigned
 *   - optimizing: spinner/progress indicator while optimization runs
 *   - assigned:   stats summary + action buttons (Optimize, Import, Equip, Export)
 *   - error:      error message with retry option
 *
 * Displays an editable name field, color swatch, WE/DA stats, and a
 * requirements status indicator (met / not met).
 *
 * Button handlers:
 *   - Optimize: POST /api/travel-config/optimize, start polling
 *   - Import:   open ImportGearsetModal via parent callback
 *   - Equip:    load gearset into Column 2 via store
 *   - Export:   copy base64gzip export string to clipboard
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.15, 4.16, 5.6, 5.7, 5.8
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Visual modes for the gearset slot */
const MODES = {
    EMPTY: 'empty',
    OPTIMIZING: 'optimizing',
    ASSIGNED: 'assigned',
    ERROR: 'error',
};

export { MODES as ROUTE_GEARSET_MODES };

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/**
 * Convert a hex color string to HSL components.
 * @param {string} hex - e.g. '#bbdefa'
 * @returns {[number, number, number]} [h (0-360), s (0-100), l (0-100)]
 */
function hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Convert HSL components to a hex color string.
 * @param {number} h - Hue 0-360
 * @param {number} s - Saturation 0-100
 * @param {number} l - Lightness 0-100
 * @returns {string} Hex color e.g. '#bbdefa'
 */
function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }

    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Derive visually distinct gearset colors from a faction base color.
 *
 * - count=1: returns [factionColor]
 * - count>1: generates `count` variants by stepping lightness downward
 *   from the base, keeping hue and saturation constant.
 *
 * Req 11.1: Each RouteGearset gets a visually distinct color.
 *
 * @param {string} factionColor - Hex color of the region faction
 * @param {number} count        - Number of colors to generate
 * @returns {string[]} Array of hex color strings
 */
export function deriveGearsetColors(factionColor, count) {
    if (count <= 1) return [factionColor];

    const [h, s, l] = hexToHsl(factionColor);

    // Use lightness stepping when there's enough range, otherwise add hue rotation
    const minL = 20;
    const maxL = 85;
    const rangeL = Math.min(l, maxL) - minL;
    const needsHueRotation = rangeL < (count - 1) * 3; // less than 3 lightness units per step

    return Array.from({ length: count }, (_, i) => {
        if (needsHueRotation) {
            // Rotate hue evenly and vary lightness within available range
            const hueStep = 360 / count;
            const newH = (h + i * hueStep) % 360;
            const lStep = rangeL > 0 ? rangeL / (count - 1) : 0;
            const newL = Math.round(Math.min(l, maxL) - i * lStep);
            return hslToHex(newH, Math.max(s, 40), Math.max(newL, minL));
        }
        // Normal case: step lightness downward from base
        const step = rangeL / (count - 1);
        const lightness = Math.round(l - i * step);
        return hslToHex(h, s, lightness);
    });
}

// ============================================================================
// ROUTEGEARSET CLASS
// ============================================================================

export default class RouteGearset {
    /**
     * @param {HTMLElement} element - Container element for this gearset slot
     * @param {Object} opts
     * @param {string}   opts.regionId      - Region this gearset belongs to
     * @param {string}   opts.gearsetId     - Unique slot key (e.g. 'single', '1', '2')
     * @param {string}   opts.name          - Display name (e.g. 'Jarvonia', 'Trellin 1')
     * @param {string}   opts.color         - Hex color for the swatch
     * @param {string[]} opts.routeIds      - Route IDs assigned to this gearset
     * @param {string}   opts.mode          - Parent region's Gearset_Mode
     * @param {Object}   opts.gearsetData   - Persisted gearset data from store
     * @param {Function} opts.onConfigChange - (key, value) => void
     * @param {Function} opts.onOptimize     - () => void
     * @param {Function} opts.onImport       - () => void
     * @param {Function} opts.onEquip        - () => void
     * @param {Function} opts.onExport       - () => void
     * @param {Function} opts.onColorChange  - (color) => void
     * @param {Function} opts.onShowFocus    - () => void
     */
    constructor(element, opts = {}) {
        this.el = typeof element === 'string' ? document.querySelector(element) : element;
        this.regionId = opts.regionId || '';
        this.gearsetId = opts.gearsetId || '';
        this.name = opts.name || '';
        this.color = opts.color || '#888888';
        this.routeIds = opts.routeIds || [];
        this.parentMode = opts.mode || 'single';
        this.gearsetData = opts.gearsetData || {};

        // Callbacks (placeholders wired in later tasks)
        this._onConfigChange = opts.onConfigChange || (() => { });
        this._onOptimize = opts.onOptimize || (() => { });
        this._onImport = opts.onImport || (() => { });
        this._onEquip = opts.onEquip || (() => { });
        this._onExport = opts.onExport || (() => { });
        this._onColorChange = opts.onColorChange || (() => { });
        this._onShowFocus = opts.onShowFocus || (() => { });

        // Internal state
        this._displayMode = this._resolveDisplayMode();
        this._errorMessage = '';
        this._taskId = null;
        this._pollIntervalId = null;
        this._isFocused = false;

        // Route list display (Req 4.8) — set by parent RegionCard after optimization
        this._routeNames = opts.routeNames || [];

        // Validation warnings (Req 9.1-9.5) — populated by validateTerrain()
        this._validationWarnings = [];

        this._render();
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /**
     * Return the current state of this gearset slot.
     */
    getState() {
        return {
            name: this.name,
            color: this.color,
            exportString: this.gearsetData.export_string || null,
            stats: this.gearsetData.stats || null,
            taskId: this._taskId,
            displayMode: this._displayMode,
            isFocused: this._isFocused,
            routeNames: this._routeNames,
        };
    }

    /**
     * Determine the display mode from the current data.
     */
    _resolveDisplayMode() {
        if (this._errorMessage) return MODES.ERROR;
        if (this._taskId) return MODES.OPTIMIZING;
        if (this.gearsetData.export_string) return MODES.ASSIGNED;
        return MODES.EMPTY;
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _render() {
        if (!this.el) return;

        this._displayMode = this._resolveDisplayMode();

        this.el.className = 'travel-gearset-slot';
        this.el.setAttribute('data-gearset-id', this.gearsetId);
        this.el.setAttribute('data-region-id', this.regionId);

        this.el.innerHTML = `
            ${this._renderHeader()}
            <div class="travel-gearset-slot-body">
                ${this._renderBody()}
            </div>
        `;

        this._attachEvents();
    }

    _renderHeader() {
        const showBtnVisible = this._displayMode === MODES.ASSIGNED;
        const focusedClass = this._isFocused ? ' travel-btn-show-active' : '';

        return `
            <div class="travel-gearset-slot-header">
                <span class="travel-gearset-color-swatch"
                      style="background:${this._escapeAttr(this.color)}"
                      title="Click to change color"></span>
                <input type="color"
                       class="travel-gearset-color-picker"
                       value="${this._escapeAttr(this.color)}"
                       aria-label="Pick gearset color" />
                <input type="text"
                       class="travel-gearset-name-input"
                       value="${this._escapeAttr(this.name)}"
                       title="Edit gearset name"
                       aria-label="Gearset name" />
                ${showBtnVisible ? `<button class="button travel-btn-show${focusedClass}" title="Show routes on map" aria-label="Show routes on map" aria-pressed="${this._isFocused}">Show</button>` : ''}
            </div>
        `;
    }

    _renderBody() {
        switch (this._displayMode) {
            case MODES.OPTIMIZING:
                return this._renderOptimizing();
            case MODES.ASSIGNED:
                return this._renderAssigned();
            case MODES.ERROR:
                return this._renderError();
            case MODES.EMPTY:
            default:
                return this._renderEmpty();
        }
    }

    /**
     * Render the empty/placeholder state.
     * Req 4.7: Show placeholder indicating empty.
     */
    _renderEmpty() {
        return `
            <div class="travel-gearset-empty">No gearset assigned</div>
            <div class="travel-gearset-actions">
                <button class="button button-primary travel-btn-optimize">Optimize</button>
                <button class="button travel-btn-import">Import</button>
            </div>
        `;
    }

    /**
     * Render the optimizing/spinner state.
     * Req 5.6: Show progress indicator while optimization is in progress.
     */
    _renderOptimizing() {
        return `
            <div class="travel-gearset-optimizing">
                <span class="travel-gearset-spinner"></span>
                <span class="travel-gearset-optimizing-text">Optimizing…</span>
            </div>
        `;
    }

    /**
     * Render the assigned state with stats and action buttons.
     * Req 4.4: Display WE%, DA%, and requirements status indicator.
     * Req 4.8: Show route list under each gearset (which routes it covers).
     * Req 5.7: Show resulting gearset stats after optimization completes.
     * Req 9.1-9.4: Show specific terrain requirement warnings.
     */
    _renderAssigned() {
        const stats = this.gearsetData.stats || {};
        const we = stats.we != null ? formatFixed(stats.we, 1) + '%' : '—';
        const da = stats.da != null ? formatFixed(stats.da, 1) + '%' : '—';
        const reqsMet = stats.requirements_met !== false;
        const reqsIcon = reqsMet ? '✓' : '⚠';
        const reqsClass = reqsMet ? 'travel-reqs-met' : 'travel-reqs-unmet';
        const reqsLabel = reqsMet ? 'All requirements met' : 'Requirements not met';

        return `
            <div class="travel-gearset-stats">
                <span class="travel-gearset-stat" title="Work Efficiency">WE: ${we}</span>
                <span class="travel-gearset-stat" title="Double Action">DA: ${da}</span>
                <span class="travel-gearset-stat ${reqsClass}" title="${reqsLabel}">${reqsIcon} Reqs</span>
            </div>
            ${this._renderValidationWarnings()}
            ${this._renderRouteList()}
            ${this._renderGearPreview()}
            <div class="travel-gearset-actions">
                <button class="button button-primary travel-btn-optimize">Optimize</button>
                <button class="button travel-btn-import">Import</button>
                <button class="button travel-btn-equip">Equip</button>
                <button class="button travel-btn-export">Export</button>
            </div>
        `;
    }

    /**
     * Decode the gearset export string and return a slot→item map.
     * Returns null if decoding fails, pako is unavailable, or catalog not loaded.
     * @returns {Object|null} { slotName: { name, icon_path, rarity } }
     * @private
     */
    _decodeGearsetSlots() {
        const exportString = this.gearsetData.export_string;
        if (!exportString || typeof window.pako === 'undefined') return null;

        // Use cached catalog only — don't block on async load here
        const catalog = window.api?._catalogCache;
        if (!catalog) return null;

        try {
            let padded = exportString;
            const padding = exportString.length % 4;
            if (padding) padded += '='.repeat(4 - padding);

            const decoded = atob(padded);
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
            const decompressed = window.pako.inflate(bytes, { to: 'string' });
            const gearsetData = JSON.parse(decompressed);

            const slots = {};
            const catalogItems = catalog.items || [];

            for (const itemData of gearsetData.items || []) {
                if (!itemData.item || itemData.item === 'null') continue;
                const itemJson = JSON.parse(itemData.item);
                const uuid = itemJson.id;
                const quality = itemJson.quality || 'common';

                const slotType = itemData.type;
                const index = itemData.index || 0;

                let slotName;
                if (slotType === 'ring') slotName = `ring${index + 1}`;
                else if (slotType === 'tool') slotName = `tool${index}`;
                else if (slotType === 'consumable') slotName = 'consumable';
                else if (slotType === 'pet') slotName = 'pet';
                else if (slotType === 'activityInput') continue;
                else slotName = slotType;

                // Handle generic items
                if (uuid && uuid.startsWith('generic::')) {
                    const genericSlots = gearsetData.generic_slots || {};
                    const gi = genericSlots[slotName];
                    if (gi) {
                        slots[slotName] = {
                            name: gi.name || slotName,
                            icon_path: gi.icon_path || null,
                            icon: gi.icon || null,
                            icon_color: gi.icon_color || null,
                            rarity: gi.rarity || 'common',
                            is_generic: true,
                        };
                    }
                    continue;
                }

                const fullItem = catalogItems.find(item => item.uuid === uuid);
                if (!fullItem) continue;

                let rarity = fullItem.rarity;
                if (fullItem.type === 'crafted_item') {
                    const qualityToRarity = {
                        'normal': 'common', 'common': 'common',
                        'good': 'uncommon', 'uncommon': 'uncommon',
                        'great': 'rare', 'rare': 'rare',
                        'excellent': 'epic', 'epic': 'epic',
                        'perfect': 'legendary', 'legendary': 'legendary',
                        'eternal': 'ethereal', 'ethereal': 'ethereal',
                    };
                    rarity = qualityToRarity[quality.toLowerCase()] || 'common';
                }

                slots[slotName] = {
                    name: fullItem.name,
                    icon_path: fullItem.icon_path,
                    rarity,
                };
            }

            return slots;
        } catch (e) {
            console.warn('[RouteGearset] Failed to decode gearset slots:', e);
            return null;
        }
    }

    /**
     * Render a compact gear preview grid showing equipped items.
     * Clicking a slot opens the ItemSelectionPopup for that slot.
     * Always renders — shows empty slots if catalog not loaded yet.
     * @private
     */
    _renderGearPreview() {
        if (!this.gearsetData.export_string) return '';

        // Try to decode slot items (requires catalog to be loaded)
        const slots = this._decodeGearsetSlots() || {};

        // Slot layout: gear rows + tool row (skip consumable/pet for travel)
        const gearSlots = [
            ['cape', 'head', 'back'],
            ['hands', 'chest', 'neck'],
            ['primary', 'legs', 'secondary'],
            ['ring1', 'feet', 'ring2'],
        ];
        const toolSlots = ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'];

        const renderSlot = (slotName) => {
            const item = slots[slotName];
            const displayName = slotName.replace(/\d+$/, '').toUpperCase();

            if (item) {
                const rarityClass = item.rarity ? `rarity-${item.rarity}` : '';
                let iconHtml;
                if (item.is_generic && item.icon_path) {
                    iconHtml = `<img src="${item.icon_path}" alt="${item.name}" class="tgs-slot-icon" onerror="this.style.display='none'">`;
                } else if (item.is_generic && item.icon) {
                    iconHtml = `<span class="tgs-slot-icon-emoji">${window.tintedEmoji ? window.tintedEmoji(item.icon, item.icon_color) : item.icon}</span>`;
                } else {
                    const iconPath = item.icon_path || '/assets/icons/items/equipment/placeholder.svg';
                    iconHtml = `<img src="${iconPath}" alt="${item.name}" class="tgs-slot-icon">`;
                }
                return `<div class="tgs-slot tgs-slot--equipped ${rarityClass}" data-tgs-slot="${slotName}" title="${this._escapeAttr(item.name)}">${iconHtml}</div>`;
            } else {
                const nameClass = displayName.length >= 8 ? 'tgs-slot-name tgs-slot-name--long' : 'tgs-slot-name';
                return `<div class="tgs-slot" data-tgs-slot="${slotName}" title="${displayName}"><span class="${nameClass}">${displayName}</span></div>`;
            }
        };

        const gearRowsHtml = gearSlots.map(row =>
            `<div class="tgs-row">${row.map(renderSlot).join('')}</div>`
        ).join('');

        const toolRowHtml = `<div class="tgs-row tgs-row--tools">${toolSlots.map(renderSlot).join('')}</div>`;

        return `
            <div class="travel-gearset-gear-preview">
                <div class="tgs-grid">
                    ${gearRowsHtml}
                    ${toolRowHtml}
                </div>
            </div>
        `;
    }

    /**
     * Render specific terrain requirement warning messages.
     * Req 9.2: Warn when skis are missing.
     * Req 9.3: Warn when diving gear is missing.
     * Req 9.4: Warn when light sources are missing.
     * Req 9.5: Warn when Navigate Desert ability is required.
     * @private
     */
    _renderValidationWarnings() {
        const warnings = this._validationWarnings || [];
        if (!warnings.length) return '';

        const warningHtml = warnings.map(w => {
            const icon = this._getWarningIcon(w);
            return `<div class="travel-gearset-warning-item">${icon} ${this._escapeHtml(w)}</div>`;
        }).join('');

        return `<div class="travel-gearset-warnings">${warningHtml}</div>`;
    }

    /**
     * Get an appropriate icon for a warning message based on its content.
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
     * Render the error state.
     * Req 5.8: Show error message describing the failure reason.
     */
    _renderError() {
        const msg = this._errorMessage || 'Optimization failed.';
        return `
            <div class="travel-gearset-error">
                <span class="travel-gearset-error-icon">✗</span>
                <span class="travel-gearset-error-msg">${this._escapeHtml(msg)}</span>
            </div>
            <div class="travel-gearset-actions">
                <button class="button button-primary travel-btn-optimize">Optimize</button>
                <button class="button travel-btn-import">Import</button>
            </div>
        `;
    }

    /**
     * Render the route list showing which routes this gearset covers.
     * Req 4.8: Show route list under each gearset (which routes it covers).
     * Only shown when routeNames is non-empty and mode is long_short, multi, or advanced.
     * @private
     */
    _renderRouteList() {
        const showModes = ['multi', 'long_short', 'advanced'];
        if (!this._routeNames.length || !showModes.includes(this.parentMode)) {
            return '';
        }

        const MAX_VISIBLE = 2;
        const visible = this._routeNames.slice(0, MAX_VISIBLE);
        const remaining = this._routeNames.length - MAX_VISIBLE;

        let routeText = visible.map(n => this._escapeHtml(n)).join(', ');
        if (remaining > 0) {
            routeText += ` <span class="travel-route-list-more">(+${remaining} more)</span>`;
        }

        return `
            <div class="travel-route-list" title="${this._escapeAttr(this._routeNames.join(', '))}">
                <span class="travel-route-list-label">Routes:</span> ${routeText}
            </div>
        `;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    _attachEvents() {
        // Editable name field (Req 4.3)
        const nameInput = this.el.querySelector('.travel-gearset-name-input');
        if (nameInput) {
            nameInput.addEventListener('change', (e) => {
                this.name = e.target.value.trim() || this.name;
                this._onConfigChange('name', this.name);
            });
            // Also update on blur for cases where user tabs away
            nameInput.addEventListener('blur', (e) => {
                const val = e.target.value.trim();
                if (val && val !== this.name) {
                    this.name = val;
                    this._onConfigChange('name', this.name);
                }
            });
        }

        // Color swatch click → open native color picker (Req 11.3)
        const swatch = this.el.querySelector('.travel-gearset-color-swatch');
        const colorPicker = this.el.querySelector('.travel-gearset-color-picker');
        if (swatch && colorPicker) {
            swatch.addEventListener('click', () => colorPicker.click());

            // Update color on picker input (live preview) and change (final)
            colorPicker.addEventListener('input', (e) => {
                const newColor = e.target.value;
                this.color = newColor;
                swatch.style.background = newColor;
                // Notify TravelMap immediately for live preview (Req 11.7)
                this._onColorChange(newColor);
            });
            colorPicker.addEventListener('change', (e) => {
                const newColor = e.target.value;
                this.color = newColor;
                swatch.style.background = newColor;
                // Persist custom color to store (Req 11.4)
                this._onConfigChange('color', newColor);
                // Notify TravelMap (Req 11.7)
                this._onColorChange(newColor);
            });
        }

        // Action buttons — Req 4.5, 4.6, 4.15, 4.16
        const optimizeBtn = this.el.querySelector('.travel-btn-optimize');
        if (optimizeBtn) {
            optimizeBtn.addEventListener('click', () => this.onOptimize());
        }

        const importBtn = this.el.querySelector('.travel-btn-import');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.onImport());
        }

        const equipBtn = this.el.querySelector('.travel-btn-equip');
        if (equipBtn) {
            equipBtn.addEventListener('click', () => this.onEquip());
        }

        const exportBtn = this.el.querySelector('.travel-btn-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.onExport());
        }

        // Show/focus button — Req 11.9, 11.16
        const showBtn = this.el.querySelector('.travel-btn-show');
        if (showBtn) {
            showBtn.addEventListener('click', () => {
                this._isFocused = !this._isFocused;
                showBtn.classList.toggle('travel-btn-show-active', this._isFocused);
                showBtn.setAttribute('aria-pressed', String(this._isFocused));
                this._onShowFocus();
            });
        }

        // Gear preview slot clicks — open ItemSelectionPopup for the clicked slot
        // Use event delegation on the slot body so it works even after re-renders
        const body = this.el.querySelector('.travel-gearset-slot-body');
        if (body) {
            body.addEventListener('click', (e) => {
                const slotEl = e.target.closest('.tgs-slot[data-tgs-slot]');
                if (!slotEl) return;
                e.stopPropagation();
                const slot = slotEl.getAttribute('data-tgs-slot');
                console.log('[RouteGearset] Slot clicked:', slot, 'popup:', !!window.itemSelectionPopup);
                if (window.itemSelectionPopup) {
                    window.itemSelectionPopup.show(slot);
                } else {
                    console.warn('[RouteGearset] itemSelectionPopup not available');
                }
            });
        }
    }

    // -------------------------------------------------------------------------
    // Button handlers — Req 4.5, 4.6, 4.15, 4.16
    // -------------------------------------------------------------------------

    /**
     * Optimize: POST to /api/travel-config/optimize, start polling.
     * Req 4.5: Triggers a background Optimization_Task.
     */
    async onOptimize() {
        // Don't start if already optimizing
        if (this._taskId) return;

        const taskKey = `${this.regionId}:${this.gearsetId}`;
        const payload = {
            task_key: taskKey,
            region_id: this.regionId,
            gearset_slot: this.gearsetId,
            mode: this.parentMode,
            route_ids: this.routeIds,
        };

        // Bug 0ca4acab: travel optimizers used to ignore per-slot locks. Build
        // locked_slots from gearset 1's per-slot locks plus the global toggle.
        const lockedSlots = {};
        const currentGear = (window.store?.state?.gearsets?.current) || {};
        const perSlotLocks = (window.store?.state?.gearsets?.lockedSlots) || {};
        for (const slotName of Object.keys(perSlotLocks)) {
            const lockValue = perSlotLocks[slotName];
            if (lockValue && typeof lockValue === 'object' && lockValue.itemId) {
                const lockData = { itemId: lockValue.itemId, quality: lockValue.quality || null };
                if (lockValue.level !== undefined) lockData.level = lockValue.level;
                lockedSlots[slotName] = lockData;
            } else if (lockValue) {
                const item = currentGear[slotName];
                if (item && item.itemId) {
                    const lockData = { itemId: item.itemId, quality: item.quality || null };
                    if (item.level !== undefined) lockData.level = item.level;
                    lockedSlots[slotName] = lockData;
                }
            }
        }
        if (window.settingsModal?.lockCurrentGearSlots) {
            for (const [slot, item] of Object.entries(currentGear)) {
                if (!item || !item.itemId) continue;
                if (lockedSlots[slot]) continue;
                lockedSlots[slot] = { itemId: item.itemId, quality: item.quality || null };
            }
        }
        if (Object.keys(lockedSlots).length > 0) {
            payload.locked_slots = lockedSlots;
        }

        try {
            const resp = await fetch('/api/travel-config/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (resp.status === 429) {
                // Task already running for this key
                if (window.api) window.api.showInfo('Optimization is already running for this gearset.');
                return;
            }

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.detail || errData.message || `Server error ${resp.status}`);
            }

            const data = await resp.json();
            if (data.success) {
                this.setOptimizing(taskKey);
                this.startPolling(taskKey);
                // Notify parent callback
                this._onOptimize();
            }
        } catch (err) {
            console.error('Travel optimize error:', err);
            if (window.api) window.api.showError(err.message || 'Optimization failed to start.');
        }
    }

    /**
     * Import: open ImportGearsetModal via parent callback.
     * Req 4.6: Opens a modal for pasting export string or selecting saved gearset.
     */
    onImport() {
        this._onImport();
    }

    /**
     * Equip: load gearset into Column 2 via the store.
     * Req 4.16: Loads the gearset into Column 2 (Gear Stats) for review.
     */
    async onEquip() {
        const exportString = this.gearsetData.export_string;
        if (!exportString) {
            if (window.api) window.api.showError('No gearset to equip.');
            return;
        }

        try {
            // Dynamically import the store to load the gearset into Column 2
            const { default: store } = await import('./state.js');
            await store.loadGearSetFromExport(exportString, null, this.name);
            if (window.api) window.api.showSuccess(`Loaded "${this.name}" into Gear Stats.`);
            // Notify parent callback
            this._onEquip();
        } catch (err) {
            console.error('Failed to equip travel gearset:', err);
            if (window.api) window.api.showError('Failed to load gearset into Gear Stats.');
        }
    }

    /**
     * Export: copy base64gzip export string to clipboard.
     * Req 4.16: Copies the gearset export string to the clipboard.
     */
    async onExport() {
        const exportString = this.gearsetData.export_string;
        if (!exportString) {
            if (window.api) window.api.showError('No gearset to export.');
            return;
        }

        try {
            await navigator.clipboard.writeText(exportString);
            if (window.api) window.api.showSuccess('Export string copied to clipboard.');
            // Notify parent callback
            this._onExport();
        } catch (err) {
            console.error('Failed to copy export string:', err);
            if (window.api) window.api.showError('Failed to copy to clipboard.');
        }
    }

    // -------------------------------------------------------------------------
    // Task polling — Req 5.6, 5.7, 5.8, 5.11, 5.12
    // -------------------------------------------------------------------------

    /**
     * Start polling for optimization task status every 2 seconds.
     * Req 5.6: Show progress indicator while optimization is in progress.
     * Req 5.12: When user returns and task still running, show loading and poll.
     * @param {string} taskKey - The task key to poll for (e.g. 'jarvonia:single')
     */
    startPolling(taskKey) {
        // Clear any existing polling first
        this.stopPolling();

        this._taskId = taskKey;

        // Poll once immediately, then every 2 seconds
        this._pollOnce();
        this._pollIntervalId = setInterval(() => this._pollOnce(), 2000);
    }

    /**
     * Stop polling for task status.
     */
    stopPolling() {
        if (this._pollIntervalId != null) {
            clearInterval(this._pollIntervalId);
            this._pollIntervalId = null;
        }
    }

    /**
     * Execute a single poll request to check task status.
     * @private
     */
    async _pollOnce() {
        if (!this._taskId) {
            this.stopPolling();
            return;
        }

        try {
            const resp = await fetch(
                `/api/travel-config/optimize-status?keys=${encodeURIComponent(this._taskId)}`
            );

            if (!resp.ok) {
                // Network/server error — don't stop polling, just log and retry
                console.warn(`Travel optimize poll error: HTTP ${resp.status}`);
                return;
            }

            const data = await resp.json();
            if (!data.success || !data.tasks) return;

            const taskResult = data.tasks[this._taskId];
            if (!taskResult) return;

            if (taskResult.status === 'complete') {
                this.onTaskComplete(taskResult);
            } else if (taskResult.status === 'error') {
                this.onTaskError(taskResult.error || 'Optimization failed.');
            }
            // status === 'running' → keep polling, do nothing
        } catch (err) {
            // Network error (offline, etc.) — keep polling, don't crash
            console.warn('Travel optimize poll network error:', err);
        }
    }

    /**
     * Handle successful task completion.
     * Req 5.7: Update to show resulting gearset stats and update map.
     * Req 5.11: When user returns and task completed, show result.
     * @param {Object} result
     * @param {string} result.export_string - Gearset export string
     * @param {Object} result.stats         - { we, da, requirements_met }
     * @param {Object} [result.route_statuses] - { routeId: status }
     */
    onTaskComplete(result) {
        this.stopPolling();
        this.setAssigned(result);

        // Notify parent to save to Travel_Config_Store and update map
        this._onConfigChange('gearset', {
            export_string: result.export_string,
            stats: result.stats,
            route_statuses: result.route_statuses || {},
        });
    }

    /**
     * Handle task failure.
     * Req 5.8: Show error message describing the failure reason.
     * @param {string} error - Error description
     */
    onTaskError(error) {
        this.stopPolling();
        this.setError(error);
    }

    // -------------------------------------------------------------------------
    // Public API — State transitions
    // -------------------------------------------------------------------------

    /**
     * Transition to the optimizing state.
     * @param {string} taskId - The background task identifier
     */
    setOptimizing(taskId) {
        this._taskId = taskId;
        this._errorMessage = '';
        this._render();
    }

    /**
     * Transition to the assigned state with optimization results.
     * Triggers terrain validation immediately (Req 9.1).
     * @param {Object} result
     * @param {string} result.export_string - Gearset export string
     * @param {Object} result.stats         - { we, da, requirements_met }
     */
    setAssigned(result) {
        this._taskId = null;
        this._errorMessage = '';
        this.gearsetData.export_string = result.export_string;
        this.gearsetData.stats = result.stats || {};
        this._render();
        // Trigger terrain validation immediately (Req 9.1)
        this.validateTerrain();

        // Ensure catalog is loaded so gear preview can render icons
        if (window.api && !window.api._catalogCache) {
            window.api.getCatalog().then(() => this._render());
        }
    }

    /**
     * Transition to the error state.
     * @param {string} message - Error description
     */
    setError(message) {
        this._taskId = null;
        this._errorMessage = message || 'Optimization failed.';
        this._render();
    }

    /**
     * Transition to the empty state (clear gearset).
     */
    setEmpty() {
        this._taskId = null;
        this._errorMessage = '';
        this.gearsetData.export_string = null;
        this.gearsetData.stats = null;
        this._render();
    }

    /**
     * Update the display name.
     * @param {string} name
     */
    setName(name) {
        this.name = name;
        const input = this.el?.querySelector('.travel-gearset-name-input');
        if (input) input.value = name;
    }

    /**
     * Update the color swatch and color picker.
     * @param {string} color - Hex color
     */
    setColor(color) {
        this.color = color;
        const swatch = this.el?.querySelector('.travel-gearset-color-swatch');
        if (swatch) swatch.style.background = color;
        const picker = this.el?.querySelector('.travel-gearset-color-picker');
        if (picker) picker.value = color;
    }

    /**
     * Set the focused state from the parent (e.g. when another gearset takes focus).
     * Req 11.16: Show button changes style when focus mode is active.
     * @param {boolean} focused
     */
    setFocused(focused) {
        this._isFocused = !!focused;
        const showBtn = this.el?.querySelector('.travel-btn-show');
        if (showBtn) {
            showBtn.classList.toggle('travel-btn-show-active', this._isFocused);
            showBtn.setAttribute('aria-pressed', String(this._isFocused));
        }
    }

    /**
     * Set the route names this gearset covers and re-render.
     * Req 4.8: Show route list under each gearset (which routes it covers).
     * @param {string[]} names - Array of route display names (e.g. ["Salsfirth → Granfiddich"])
     */
    setRouteNames(names) {
        this._routeNames = names || [];
        this._render();
    }

    /**
     * Update the gearset data and re-render.
     * Triggers terrain validation if a gearset is assigned (Req 9.1).
     * @param {Object} data - Gearset data from store
     */
    setGearsetData(data) {
        this.gearsetData = data || {};
        if (data.name) this.name = data.name;
        if (data.color) this.color = data.color;
        this._render();
        // Trigger terrain validation if gearset is assigned (Req 9.1)
        if (this.gearsetData.export_string) {
            this.validateTerrain();
            // Ensure catalog is loaded so gear preview can render icons
            if (window.api && !window.api._catalogCache) {
                window.api.getCatalog().then(() => this._render());
            }
        }
    }

    /**
     * Validate the assigned gearset against terrain requirements for its routes.
     * Calls the backend validation endpoint and updates warnings + map status.
     * Req 9.1: Evaluate terrain requirements immediately after gearset is assigned or imported.
     * Req 9.2-9.4: Show specific warnings for skis, diving gear, light sources.
     * Req 9.6: Update Route_Status on the map.
     */
    async validateTerrain() {
        const exportString = this.gearsetData.export_string;
        if (!exportString || !this.routeIds.length) {
            this.setValidationWarnings([]);
            return;
        }

        try {
            const resp = await fetch('/api/travel-config/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    export_string: exportString,
                    route_ids: this.routeIds,
                }),
            });

            if (!resp.ok) {
                console.warn('Terrain validation request failed:', resp.status);
                return;
            }

            const data = await resp.json();
            if (!data.success) return;

            // Collect all unique warnings across routes
            const allWarnings = [];
            let allMet = true;
            const routeStatuses = {};

            for (const [routeId, result] of Object.entries(data.results || {})) {
                if (!result.met) {
                    allMet = false;
                    for (const msg of (result.missing || [])) {
                        if (!allWarnings.includes(msg)) {
                            allWarnings.push(msg);
                        }
                    }
                    routeStatuses[routeId] = 'assigned_unmet';
                } else {
                    routeStatuses[routeId] = 'assigned_met';
                }
            }

            // Update requirements_met in stats
            if (this.gearsetData.stats) {
                this.gearsetData.stats.requirements_met = allMet;
            }

            this.setValidationWarnings(allWarnings);

            // Notify parent to update map route statuses (Req 9.6)
            this._onConfigChange('validation', {
                requirements_met: allMet,
                route_statuses: routeStatuses,
                warnings: allWarnings,
            });
        } catch (err) {
            console.warn('Terrain validation error:', err);
        }
    }

    /**
     * Set validation warning messages and re-render the warnings area.
     * @param {string[]} warnings - Array of warning messages
     */
    setValidationWarnings(warnings) {
        this._validationWarnings = warnings || [];
        // Update the warnings area without full re-render
        const body = this.el?.querySelector('.travel-gearset-slot-body');
        if (body) {
            const existing = body.querySelector('.travel-gearset-warnings');
            const newHtml = this._renderValidationWarnings();
            if (existing) {
                if (newHtml) {
                    existing.outerHTML = newHtml;
                } else {
                    existing.remove();
                }
            } else if (newHtml) {
                // Insert warnings after the stats row
                const statsRow = body.querySelector('.travel-gearset-stats');
                if (statsRow) {
                    statsRow.insertAdjacentHTML('afterend', newHtml);
                }
            }
            // Also update the requirements indicator
            const reqsSpan = body.querySelector('.travel-reqs-met, .travel-reqs-unmet');
            if (reqsSpan) {
                const met = this._validationWarnings.length === 0;
                reqsSpan.className = `travel-gearset-stat ${met ? 'travel-reqs-met' : 'travel-reqs-unmet'}`;
                reqsSpan.textContent = met ? '✓ Reqs' : '⚠ Reqs';
                reqsSpan.title = met ? 'All requirements met' : 'Requirements not met';
            }
        }
    }

    /**
     * Full re-render with current state.
     */
    refresh() {
        this._render();
    }

    /**
     * Clean up DOM and polling.
     */
    destroy() {
        this.stopPolling();
        if (this.el) this.el.innerHTML = '';
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _escapeAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
