/**
 * SettingsModal component
 * 
 * Modal for managing session settings.
 * Features:
 * - Display current session UUID
 * - Input field to switch to different session
 * - Close button and click-outside-to-close
 * - jQuery fadeIn/fadeOut for smooth transitions
 * - Session switching with validation
 */

import Component from './base.js';
import api from '../api.js';
import store from '../state.js';
import { isAnimationsEnabled, isTextEnabled, setAnimationsEnabled, setTextEnabled } from '../april-fools.js';
import { LINE_COLOR_PALETTES, DEFAULT_PALETTE } from './crafting-tree-settings.js';
import { mountXyPriorityList, defaultRecipeEntries, ensureXyStyles, findScrollParent, updateAutoScroll, stopAutoScroll } from './xy-recipe-priority-list.js';
import { mountXyActivityPriorityList, defaultActivityEntries } from './xy-activity-priority-list.js';
import { mountTravelPriorityList, defaultTravelEntries, normalizeTravelEntries } from './travel-priority-list.js';
import { getNumberFormatPrefs, setNumberFormatPrefs } from '../utils/number-format.js';

/**
 * Apply crafting tree depth line colors as CSS variables on a <style> tag.
 * Called on palette change (live) and on tree render.
 */
export function _applyCraftingTreeColors(settings) {
    const palette = settings?.line_colors || DEFAULT_PALETTE;
    const colors = (palette === 'Custom' && settings?.custom_colors?.length === 8)
        ? settings.custom_colors
        : (LINE_COLOR_PALETTES[palette] || LINE_COLOR_PALETTES[DEFAULT_PALETTE]);
    let styleEl = document.getElementById('ct-depth-colors');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ct-depth-colors';
        document.head.appendChild(styleEl);
    }
    const vars = colors.map((c, i) => `--ct-depth-color-${i}: ${c};`).join(' ');
    styleEl.textContent = `.crafting-tree-view { ${vars} }`;
}

class SettingsModal extends Component {
    /**
     * Create a settings modal
     * @param {HTMLElement|string} element - Container element
     */
    constructor(element) {
        super(element);
        this.visible = false;
        this.errorMessage = '';
        this.isSubmitting = false;
        this.activeTab = 'user'; // 'user', 'optimization', or 'personalization'
        this.customColorTertiary = this.loadCustomColor('customBgTertiary', '#2e2e2e');
        this.customColorHover = this.loadCustomColor('customBgHover', '#333333');
        this.orderByLevel = this.loadBoolSetting('orderActivitiesByLevel', true);
        this.hideUnapplicableStats = this.loadBoolSetting('hideUnapplicableStats', false);
        this.popupAutoCollapseOnScroll = this.loadBoolSetting('popupAutoCollapseOnScroll', true);
        this.popupAutoCollapseNoRestore = this.loadBoolSetting('popupAutoCollapseNoRestore', false);
        this.popupAutoCollapseTopMin = parseInt(localStorage.getItem('popupAutoCollapseTopMin') || '10', 10);
        this.popupAutoCollapseAltMin = parseInt(localStorage.getItem('popupAutoCollapseAltMin') || '10', 10);
        this.popupItemListMin = parseInt(localStorage.getItem('popupItemListMin') || '0', 10);
        // Non-owned upgrade display mode for the gear slot popup's
        // "Non-owned/Locked Upgrades" section. One of:
        //   'average' — old ⟶ new aggregate of all target drops (default)
        //   'percent' — the aggregate improvement as +/-X%
        //   'list'    — one line per individual target drop (taller blocks)
        // localStorage-only (display preference) — deliberately NOT in
        // ui_config presets/share strings.
        this.nonOwnedUpgradeDisplay = this.loadNonOwnedUpgradeDisplay();
        this.hotkeysEnabled = this.loadBoolSetting('hotkeysEnabled', true);
        this.useWikiDarkMode = this.loadBoolSetting('useWikiDarkMode', true);
        this.numberFormat = getNumberFormatPrefs();
        this.aprilFoolsAnimations = isAnimationsEnabled();
        this.aprilFoolsText = isTextEnabled();

        // Optimization settings
        this.activitySorting = [];
        this.recipeSorting = [];
        this.travelSorting = [];
        this.sortingOptions = { activity: [], recipe: [], travel: [] };
        this.includeConsumables = false;
        this.includePets = false;
        this.runLocalOptimization = false;
        this.finishOnServerOnLeave = false;
        this.disableLocalOptWarning = false;
        this.showItemFindingDrops = this.loadShowItemFindingDrops();
        this.autoEquipOptimized = false;
        this.lockCurrentGearSlots = false;
        this.showNonOwnedAlternatives = true;  // Always on for everyone
        this.skipObtainedCollectibles = this.loadBoolSetting('skipObtainedCollectibles', true);

        // Collapsible section state (persisted in localStorage)
        this.collapsedSections = {
            global: this.loadBoolSetting('settingsCollapsed_global', false),
            activity: this.loadBoolSetting('settingsCollapsed_activity', false),
            recipe: this.loadBoolSetting('settingsCollapsed_recipe', false),
            travel: this.loadBoolSetting('settingsCollapsed_travel', false),
            popup: this.loadBoolSetting('settingsCollapsed_popup', false),
            misc: this.loadBoolSetting('settingsCollapsed_misc', false),
            themeColors: this.loadBoolSetting('settingsCollapsed_themeColors', false),
            numberFormat: this.loadBoolSetting('settingsCollapsed_numberFormat', false),
        };

        // Dismissed tips (persisted in localStorage)
        this.dismissedTips = {
            excludeTip: this.loadBoolSetting('settingsDismissed_excludeTip', false),
            weightTip: this.loadBoolSetting('settingsDismissed_weightTip', false),
        };

        // Optimization presets
        this.activityPresets = [];
        this.recipePresets = [];
        this.travelPresets = [];
        this.selectedActivityPresetId = null;
        this.selectedRecipePresetId = null;
        this.selectedTravelPresetId = null;

        // Push notification state
        this._pushSubscription = null;
        this._pushPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
        this._pushPrefs = { global_announcements: false, targeted_announcements: false };
        this._pushVapidKey = null;
        this._pushLoading = false;
        this._pushConfigError = false;
        this._pushInitError = null;

        // Load optimization settings (async, will re-render when loaded)
        this.loadOptimizationSettings();
        this.loadOptimizationPresets();
        this._loadColorPresets();

        this.render();
        this.attachEvents();
    }

    /**
     * Load optimization settings from API
     * Data model: activitySorting and recipeSorting are arrays of [metric_key, weight] tuples
     * where weight is an integer 0-100.
     */
    async loadOptimizationSettings() {
        try {
            const response = await $.get('/api/optimization-settings');
            console.log('Loaded optimization settings:', response);

            this.sortingOptions = {
                activity: response.activity.options,
                recipe: response.recipe.options
            };
            // Travel sorting options + current order (simple [key,weight,target]
            // tuples). Backend allowlists options to total_steps +
            // travel_steps_per_target and defaults to a single Total Steps entry.
            this.sortingOptions.travel = (response.travel && response.travel.options) || [];
            this.travelSorting = normalizeTravelEntries(response.travel && response.travel.current_order);

            // Activity sorting: still legacy [key, weight, target] tuples.
            // Recipe sorting: new X-per-Y dict form from the backend migration.
            // We pass it through to the mount controller as-is — no tuple normalization.
            this.activitySorting = this._normalizeSortingTuples(response.activity.current_order);
            this.recipeSorting = Array.isArray(response.recipe.current_order)
                ? response.recipe.current_order.filter(e => e && typeof e === 'object' && (e.mode === 'ratio' || e.mode === 'budget'))
                : [];

            // Load consumables flags from response or default to false
            this.includeConsumables = response.include_consumables || false;

            // Load global optimization flags
            this.includePets = response.include_pets || false;
            this.runLocalOptimization = response.run_local_optimization || false;
            this.finishOnServerOnLeave = response.finish_on_server_on_leave || false;
            this.disableLocalOptWarning = response.disable_local_opt_warning || false;
            // Whether the current session is a bug-report snapshot. Used by the
            // local-speed-warning controller to skip benchmarking/nudging here.
            this.isSnapshotSession = response.is_snapshot || false;
            this.autoEquipOptimized = response.auto_equip_optimized || false;
            this.autoCopyExport = response.auto_copy_export || false;
            this.lockCurrentGearSlots = response.lock_current_gear_slots || false;
            // showNonOwnedAlternatives is always on for everyone now
            this.showNonOwnedAlternatives = true;
            // Skip obtained collectibles — load from backend, fall back to localStorage
            if (response.skip_obtained_collectibles !== undefined) {
                this.skipObtainedCollectibles = response.skip_obtained_collectibles;
            }

            console.log('Activity sorting loaded:', this.activitySorting);
            console.log('Recipe sorting loaded:', this.recipeSorting);
            console.log('Include consumables:', this.includeConsumables);

            // Re-render if we're on the optimization tab
            if (this.activeTab === 'optimization' && this.visible) {
                this.render();
                this.attachEvents();
            }

            // Notify other components that optimization settings have loaded
            window.dispatchEvent(new CustomEvent('optimizationSettingsLoaded'));
        } catch (error) {
            console.error('Failed to load optimization settings:', error);
        }
    }

    /**
     * Normalize sorting data to [key, weight] tuple format.
     * Handles both old format (plain string arrays) and new format ([key, weight] tuples).
     * @param {Array} sortingList - Array of strings or [key, weight, target] tuples
     * @returns {Array} Array of [key, weight, target] tuples
     */
    _normalizeSortingTuples(sortingList) {
        if (!sortingList || !sortingList.length) return [];
        // Allow duplicates for keys marked duplicable on the Sorting enum
        const duplicableKeys = new Set();
        const allOptions = [...(this.sortingOptions?.activity || []), ...(this.sortingOptions?.recipe || [])];
        for (const opt of allOptions) {
            if (opt.duplicable) duplicableKeys.add(opt.key);
        }
        const seen = new Set();
        const result = [];
        for (const entry of sortingList) {
            // Pass-through for new X-per-Y dict form (recipe AND activity).
            // The XY component's normalizeEntry handles validation; we just
            // forward the dict shape unchanged so the priority list keeps
            // its rich state (mode, x, y, targetItem, hiddenInQuick, etc.).
            if (entry && typeof entry === 'object' && !Array.isArray(entry) && (entry.mode === 'ratio' || entry.mode === 'budget')) {
                result.push(entry);
                continue;
            }
            let key, weight, target;
            if (typeof entry === 'string') {
                key = entry;
                weight = 100;
                target = null;
            } else if (Array.isArray(entry) && entry.length >= 2) {
                key = entry[0];
                // Preserve 0 weight — use isNaN check instead of `|| 100`
                const parsed = Number(entry[1]);
                weight = isNaN(parsed) ? 100 : Math.max(0, Math.min(100, Math.floor(parsed)));
                target = entry.length >= 3 ? (entry[2] || null) : null;
            } else {
                key = String(entry);
                weight = 100;
                target = null;
            }
            // Repair corrupted keys like "steps_per_reward_roll,100," from previous bug
            if (typeof key === 'string' && key.includes(',')) {
                key = key.split(',')[0].trim();
            }
            // Deduplicate non-duplicable keys (corrupted data may have duplicates)
            if (seen.has(key) && !duplicableKeys.has(key)) continue;
            seen.add(key);
            result.push([key, weight, target]);
        }
        return result;
    }

    /**
     * Update the weight in the internal data model from a sort-item DOM element.
     * @param {jQuery} $item - The .sort-item element
     */
    _updateWeightFromDOM($item) {
        const index = parseInt($item.data('index'), 10);
        const weight = parseInt($item.find('.weight-slider').val(), 10);
        const isActivity = $item.closest('.sort-list').hasClass('activity-sort-list');

        const sorting = isActivity ? this.activitySorting : this.recipeSorting;
        if (index >= 0 && index < sorting.length) {
            sorting[index][1] = weight;
        }
        // Clear preset selection since user manually changed settings
        this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
        // Debounce save — clear previous timer and set new one
        clearTimeout(this._weightSaveTimer);
        this._weightSaveTimer = setTimeout(() => this.saveOptimizationSettings(), 300);
    }

    /**
     * Clear the preset selection for a type (user manually changed settings).
     * @param {string} presetType - 'activity' or 'recipe'
     */
    _clearPresetSelection(presetType) {
        const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
        this['selected' + _cap + 'PresetId'] = null;
    }

    /**
     * Update the slider track background to show a filled blue bar from 0 to current value.
     * @param {HTMLInputElement} slider - The range input element
     */
    _updateSliderTrack(slider) {
        const val = slider.value;
        const pct = ((val - slider.min) / (slider.max - slider.min)) * 100;
        slider.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${pct}%, var(--bg-primary) ${pct}%, var(--bg-primary) 100%)`;
    }

    /**
     * Re-render the optimization tab while preserving scroll position.
     * Used by remove, add, and reset handlers.
     */
    _rerenderOptimizationTab() {
        // Save scroll position before re-render
        const $modal = this.$element.find('.settings-modal');
        const scrollTop = $modal.scrollTop();

        this.render();
        this.attachEvents();
        // Only force the modal open if it was already visible — this function
        // is also called from the inline panel (via loadOptimizationPresets,
        // savePreset, etc.) where we must NOT open the modal.
        if (this.visible) {
            this.$element.find('.modal-overlay').css('display', 'flex').addClass('show');
            this.activeTab = 'optimization';
            this.$element.find('.tab-content').hide();
            this.$element.find('.optimization-tab').show();
            this.$element.find('.settings-tab').removeClass('active');
            this.$element.find('.settings-tab[data-tab="optimization"]').addClass('active');
        }

        // Restore scroll position after re-render
        this.$element.find('.settings-modal').scrollTop(scrollTop);
    }

    /**
     * Load custom color from localStorage
     * @param {string} key - localStorage key
     * @param {string} defaultValue - Default color value
     * @returns {string} Hex color code
     */
    loadCustomColor(key, defaultValue) {
        return localStorage.getItem(key) || defaultValue;
    }

    /**
     * Render a small preview string showing the user's current thousand/decimal
     * separators applied to a representative value. Uses the patched
     * Number.prototype.toLocaleString so it always reflects the live prefs.
     * @returns {string}
     */
    _renderNumberFormatPreview() {
        return (1234567.89).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /**
     * Load a boolean setting from localStorage
     * @param {string} key - localStorage key
     * @param {boolean} defaultValue - Default if not set
     * @returns {boolean}
     */
    loadBoolSetting(key, defaultValue) {
        const saved = localStorage.getItem(key);
        return saved === null ? defaultValue : saved === 'true';
    }

    /**
     * Load the non-owned upgrade display mode from localStorage.
     * @returns {'average'|'percent'|'list'} Defaults to 'average'.
     */
    loadNonOwnedUpgradeDisplay() {
        const saved = localStorage.getItem('nonOwnedUpgradeDisplay');
        return (saved === 'percent' || saved === 'list') ? saved : 'average';
    }

    /**
     * Load show item finding drops setting from localStorage
     * @returns {boolean} Whether to show item finding drops
     */
    loadShowItemFindingDrops() {
        const saved = localStorage.getItem('showItemFindingDrops');
        return saved === null ? true : saved === 'true';  // Default to true (respect explicit opt-out)
    }

    /**
     * Save show item finding drops setting to localStorage
     * @param {boolean} value - Whether to show item finding drops
     */
    saveShowItemFindingDrops(value) {
        this.showItemFindingDrops = value;
        localStorage.setItem('showItemFindingDrops', value.toString());
        console.log('saveShowItemFindingDrops:', value);

        // Dispatch a custom event so other components can react
        window.dispatchEvent(new CustomEvent('showItemFindingDropsChanged', { detail: { value } }));
    }

    /**
     * Persist April Fools toggle state to session config so it survives across devices/sessions.
     * Also sets april_fools_disabled in ui_config when both toggles are off.
     */
    _persistAprilFoolsState() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        api.updateConfig(uuid, 'ui.april_fools_animations', this.aprilFoolsAnimations);
        api.updateConfig(uuid, 'ui.april_fools_text', this.aprilFoolsText);
    }

    /**
     * Save custom color to localStorage and apply it
     * @param {string} key - localStorage key
     * @param {string} cssVar - CSS variable name
     * @param {string} color - Hex color code
     */
    saveCustomColor(key, cssVar, color) {
        if (key === 'customBgTertiary') {
            this.customColorTertiary = color;
        } else if (key === 'customBgHover') {
            this.customColorHover = color;
        }
        localStorage.setItem(key, color);
        document.documentElement.style.setProperty(cssVar, color);
    }

    /**
     * Render the settings modal HTML
     * @returns {string} HTML string
     */
    render() {
        const currentUuid = store.state.session.uuid || 'No session loaded';

        const html = `
            <div class="modal-overlay" style="display: none;">
                <div class="modal settings-modal">
                    <div class="modal-header">
                        <h2>Settings</h2>
                        <button class="close-btn" ${this.isSubmitting ? 'disabled' : ''}>&times;</button>
                    </div>
                    <div class="settings-tabs">
                        <button type="button" class="settings-tab ${this.activeTab === 'user' ? 'active' : ''}" data-tab="user">User</button>
                        <button type="button" class="settings-tab ${this.activeTab === 'ui' ? 'active' : ''}" data-tab="ui">UI</button>
                        <button type="button" class="settings-tab ${this.activeTab === 'optimization' ? 'active' : ''}" data-tab="optimization">Optimization</button>
                        <button type="button" class="settings-tab ${this.activeTab === 'personalization' ? 'active' : ''}" data-tab="personalization">Personalization</button>
                    </div>
                    <div class="modal-content">
                        <div class="tab-content user-tab" style="display: ${this.activeTab === 'user' ? 'block' : 'none'};">
                            ${this.renderUserTab(currentUuid)}
                        </div>
                        <div class="tab-content ui-tab" style="display: ${this.activeTab === 'ui' ? 'block' : 'none'};">
                            ${this.renderUiTab()}
                        </div>
                        <div class="tab-content optimization-tab" style="display: ${this.activeTab === 'optimization' ? 'block' : 'none'};">
                            ${this.renderOptimizationTab()}
                        </div>
                        <div class="tab-content personalization-tab" style="display: ${this.activeTab === 'personalization' ? 'block' : 'none'};">
                            ${this.renderPersonalizationTab()}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);
        return html;
    }

    /**
     * Render the User tab content
     * @param {string} currentUuid - Current session UUID
     * @returns {string} HTML string
     */
    renderUserTab(currentUuid) {
        const hasCharacter = !!(store.state.character && store.state.character.name);
        return `
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <button 
                    class="button button-primary export-config-btn" 
                    ${hasCharacter ? '' : 'disabled'}
                    style="width: 100%;"
                    title="${hasCharacter ? 'Export your character config as JSON (same format as game export)' : 'Import a character first to enable export'}"
                >
                    Export Config
                </button>
                <p style="margin-top: var(--spacing-xs); color: var(--text-secondary); font-size: 0.8em;">
                    Exports your character data as JSON — same format as the game export, ready to re-import.
                </p>
            </div>
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Current Session UUID:</label>
                <input 
                    type="text" 
                    class="uuid-display" 
                    value="${currentUuid}" 
                    readonly
                    style="
                        width: 100%;
                        padding: var(--spacing-sm);
                        background-color: var(--bg-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        color: var(--text-secondary);
                        font-family: monospace;
                        font-size: 0.9em;
                    "
                >
            </div>
            <div class="setting-row">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Switch to Session:</label>
                <input 
                    type="text" 
                    class="uuid-input" 
                    placeholder="Enter UUID to switch sessions"
                    ${this.isSubmitting ? 'disabled' : ''}
                    style="
                        width: 100%;
                        padding: var(--spacing-sm);
                        background-color: var(--bg-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        color: var(--text-primary);
                        font-family: monospace;
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    "
                >
                ${this.errorMessage ? `
                    <div class="settings-error" style="
                        margin-top: var(--spacing-sm);
                        padding: var(--spacing-sm);
                        background-color: var(--rarity-ethereal);
                        border: 1px solid #8c2a2a;
                        border-radius: 4px;
                        color: var(--text-primary);
                        font-size: 0.9em;
                    ">
                        <strong>Error:</strong> ${this.errorMessage}
                    </div>
                ` : ''}
                <button 
                    class="button button-primary switch-session-btn" 
                    ${this.isSubmitting ? 'disabled' : ''}
                    style="width: 100%;"
                >
                    ${this.isSubmitting ? 'Switching...' : 'Switch Session'}
                </button>
            </div>
        `;
    }

    /**
     * Render the Optimization tab content
     * @returns {string} HTML string
     */
    renderOptimizationTab() {
        // Map category values to display names for sort item labels
        const categoryDisplayNames = {
            'cat:normal_items': 'Normal Items', 'cat:chests': 'Chests',
            'cat:collectibles': 'Collectibles', 'cat:fine': 'Fine Items',
            'cat:gems': 'Gems', 'cat:gems_fine': 'Gems (Fine)',
            'cat:if:adventurers_guild_tokens': "Adventurers' Guild Tokens",
            'cat:if:adventurers_guild_tokens_fine': "Adventurers' Guild Tokens (Fine)",
            'cat:if:bird_nest': 'Bird Nest', 'cat:if:bird_nest_fine': 'Bird Nest (Fine)',
            'cat:if:crustacean': 'Crustacean', 'cat:if:crustacean_fine': 'Crustacean (Fine)',
            'cat:if:ectoplasm': 'Ectoplasm', 'cat:if:ectoplasm_fine': 'Ectoplasm (Fine)',
            'cat:if:fibrous_plant': 'Fibrous Plant', 'cat:if:fibrous_plant_fine': 'Fibrous Plant (Fine)',
            'cat:if:fishing_bait': 'Fishing Bait', 'cat:if:fishing_bait_fine': 'Fishing Bait (Fine)',
            'cat:if:gold_nugget': 'Gold Nugget', 'cat:if:gold_nugget_fine': 'Gold Nugget (Fine)',
            'cat:if:random_gem': 'Random Gem', 'cat:if:random_gem_fine': 'Random Gem (Fine)',
            'cat:if:random_piece_of_junk': 'Random Piece of Junk',
            'cat:if:random_piece_of_junk_fine': 'Random Piece of Junk (Fine)',
            'cat:if:skill_chest': 'Random Skill Chest',
            'cat:if:sea_shells': 'Sea Shells',
        };
        const getTargetDisplayName = (val) => {
            if (!val) return '';
            return categoryDisplayNames[val] || val;
        };

        const renderSortList = (sorting, options, listClass) => {
            // Ensure the shared .xy-reorder-strip styles are injected so the
            // activity sort list's up/down arrow strip renders correctly.
            // Normally injected by mountXyPriorityList on the recipe side;
            // activity uses this legacy function instead so we inject here.
            ensureXyStyles();
            const isSingle = sorting.length <= 1;
            // For the add dropdown, show ALL options (duplicable ones always, others only if not used)
            const usedKeys = new Set(sorting.map(entry => entry[0]));
            const availableOptions = options.filter(opt => opt.duplicable || !usedKeys.has(opt.key));

            const items = sorting.map((entry, index) => {
                const [key, weight, target] = entry;
                const option = options.find(opt => opt.key === key);
                if (!option) return '';

                // Duplicate button: only for duplicable options, whitespace placeholder for others
                const duplicateBtn = option.duplicable
                    ? `<button class="sort-duplicate-btn" title="Duplicate this priority">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                            <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                        </svg>
                       </button>`
                    : `<span class="sort-duplicate-placeholder"></span>`;

                const targetAttr = target ? ` data-target="${target}"` : '';

                // Build embedded target control (like inline panel).
                // Always render the dropdown for target-enabled keys, defaulting to
                // 'cat:normal_items' (drop) / 'Perfect' (quality) when target is null.
                let embeddedTargetHtml = '';
                const targetDropKeys = new Set(['steps_per_reward_roll']);
                const targetQualityKeys = new Set(['materials_for_target', 'steps_for_target', 'total_crafts']);

                if (targetDropKeys.has(key)) {
                    const displayTarget = target || 'cat:normal_items';
                    const displayName = getTargetDisplayName(displayTarget);
                    // Get icon from OptimizeButton if available
                    const optimizeBtn = window.optimizeButton;
                    const iconPath = optimizeBtn ? optimizeBtn._getCategoryIcon(displayTarget) : '';
                    const isFine = displayTarget.includes('fine');
                    const iconClass = isFine ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';
                    const iconHtml = iconPath ? `<img src="${iconPath}" alt="${displayName}" class="${iconClass}" />` : '';

                    // Skip collectibles checkbox (only shown when target is Collectibles category)
                    let skipCollectiblesHtml = '';
                    if (displayTarget === 'cat:collectibles') {
                        const skipEnabled = this.skipObtainedCollectibles || false;
                        const skipChecked = skipEnabled ? 'checked' : '';
                        const labelStyle = skipEnabled
                            ? 'color:var(--stat-positive);font-style:italic;'
                            : 'color:var(--text-secondary);';
                        skipCollectiblesHtml = `
                            <label class="optimizer-checkbox" style="margin-top:6px;font-size:0.85em;display:flex;align-items:center;gap:6px;">
                                <input type="checkbox" class="skip-obtained-collectibles" ${skipChecked} />
                                <span class="optimizer-checkbox-label" style="${labelStyle}font-weight:600;">Skip collectibles when all obtained</span>
                            </label>`;
                    }

                    embeddedTargetHtml = `
                        <div class="sort-embedded-target" data-sort-index="${index}" data-target-type="drop" style="margin-top:6px;">
                            <div class="target-label" style="font-size:0.8em;margin-bottom:2px;">Target Drop</div>
                            <div class="target-dropdown-button sort-target-btn" data-sort-index="${index}" style="padding:6px 10px;">
                                <div class="target-dropdown-value" style="gap:6px;">
                                    ${iconHtml}
                                    <span style="font-size:0.9em;">${displayName}</span>
                                </div>
                                <button class="target-dropdown-toggle">
                                    <span class="expand-arrow">▼</span>
                                </button>
                            </div>
                            <div class="sort-target-dropdown" data-sort-index="${index}" style="display:none;"></div>
                            ${skipCollectiblesHtml}
                        </div>`;
                } else if (targetQualityKeys.has(key)) {
                    const displayQuality = target || 'Perfect';
                    const qualityColors = { 'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)', 'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)', 'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)' };
                    const qualityBorders = { 'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)', 'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)', 'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)' };
                    const bg = qualityColors[displayQuality] || '';
                    const border = qualityBorders[displayQuality] || '';
                    const btnStyle = (bg && border) ? `background:${bg};border:2px solid ${border};padding:6px 10px;` : 'padding:6px 10px;';

                    embeddedTargetHtml = `
                        <div class="sort-embedded-target" data-sort-index="${index}" data-target-type="quality" style="margin-top:6px;">
                            <div class="target-label" style="font-size:0.8em;margin-bottom:2px;">Target Quality</div>
                            <div class="target-dropdown-button sort-target-btn" data-sort-index="${index}" style="${btnStyle}">
                                <div class="target-dropdown-value" style="gap:6px;">
                                    <span style="font-size:0.9em;">${displayQuality}</span>
                                </div>
                                <button class="target-dropdown-toggle">
                                    <span class="expand-arrow">▼</span>
                                </button>
                            </div>
                            <div class="sort-target-dropdown" data-sort-index="${index}" style="display:none;"></div>
                        </div>`;
                }

                // Reorder strip: up arrow, hamburger (drag handle), down arrow.
                // Matches the recipe-side XY component so both optimization
                // panels have the same mobile-friendly reorder affordance.
                const atTop = index === 0;
                const atBottom = index === sorting.length - 1;
                const reorderStrip = `
                    <div class="xy-reorder-strip">
                        <button class="xy-move-up" ${atTop ? 'disabled' : ''} title="Move up" data-index="${index}" data-list-class="${listClass}" tabindex="-1">▲</button>
                        <span class="drag-handle" title="Drag to reorder">☰</span>
                        <button class="xy-move-down" ${atBottom ? 'disabled' : ''} title="Move down" data-index="${index}" data-list-class="${listClass}" tabindex="-1">▼</button>
                    </div>
                `;

                return `
                    <div class="sort-item" data-key="${key}" data-index="${index}" data-weight="${weight}"${targetAttr}>
                        ${reorderStrip}
                        <div class="sort-item-content">
                            <span class="sort-name">${option.display_name}</span>
                            <div class="sort-weight-row">
                                <input type="range" class="weight-slider" min="0" max="100" value="${weight}" />
                                <input type="number" class="weight-input" min="0" max="100" value="${weight}" />
                                <span class="weight-pct">%</span>
                            </div>
                            ${embeddedTargetHtml}
                        </div>
                        ${duplicateBtn}
                        <button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority">✕</button>
                    </div>
                `;
            }).join('');

            // Add button with dropdown
            const addDropdownOptions = availableOptions.map(opt =>
                `<option value="${opt.key}">${opt.display_name}</option>`
            ).join('');

            const addButton = availableOptions.length > 0 ? `
                <div class="sort-add-wrapper">
                    <button class="sort-add-btn" title="Add optimization priority">+ Add Optimization Priority</button>
                    <select class="sort-add-dropdown" style="display:none;">
                        <option value="">Select a metric...</option>
                        ${addDropdownOptions}
                    </select>
                </div>
            ` : '';

            return `
                ${addButton}
                <div class="sort-list ${listClass}">
                    ${items}
                </div>
                <button class="sort-reset-btn" data-list="${listClass}">↺ Reset to Default</button>
            `;
        };

        const collapsibleHeader = (label, sectionKey) => {
            const isCollapsed = this.collapsedSections[sectionKey];
            return `
                <h3 class="settings-collapsible-header ${isCollapsed ? 'collapsed' : ''}" data-section="${sectionKey}">
                    <span class="expand-arrow ${isCollapsed ? '' : 'expanded'}">▼</span>
                    ${label}
                </h3>`;
        };

        return `
            <div class="optimization-settings">
                ${!this.dismissedTips.excludeTip ? `
                <div class="settings-dismissible-tip" data-tip="excludeTip">
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin: 0;
                    ">💡 <strong>Tip:</strong> To exclude specific items or consumables from optimization, go to the <strong>Owned Items</strong> section in Column 1 and check the "Hide" checkbox. This works for both normal and fine consumables.</p>
                    <button class="settings-dismiss-tip-btn" data-tip="excludeTip" title="Dismiss this tip">✕</button>
                </div>` : ''}
                
                ${!this.dismissedTips.weightTip ? `
                <div class="settings-dismissible-tip weight-explanation" data-tip="weightTip">
                    <span class="weight-explanation-icon">ℹ️</span>
                    <div>
                        <p>The weight slider sets a <strong>minimum threshold</strong>: the optimizer won't let a goal drop below this % of its best achievable value.</p>
                        <p>At <strong>100%</strong>, the next priority is used only as a tiebreaker. Lower values give the optimizer more flexibility to improve lower-priority goals.</p>
                    </div>
                    <button class="settings-dismiss-tip-btn" data-tip="weightTip" title="Dismiss this tip">✕</button>
                </div>` : `
                <div class="weight-explanation" style="display: none;"></div>`}
                
                <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                    ${collapsibleHeader('Global Optimization Settings', 'global')}
                    <div class="settings-collapsible-body" data-section="global" style="${this.collapsedSections.global ? 'display:none;' : ''}">
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="show-item-finding-drops-checkbox" ${this.showItemFindingDrops ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Show item finding drops in Target Drop</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Include drops from item finding stats (e.g., Chance to find fishing bait) in the "Target Drop for Steps/Reward Roll" drop down.</p>
                    </div>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="auto-equip-optimized-checkbox" ${this.autoEquipOptimized ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Immediately equip optimized gear set</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Automatically equip the optimized gear set when optimization completes, instead of showing an "Equip" button.</p>
                    </div>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="auto-copy-export-checkbox" ${this.autoCopyExport ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Auto copy export string to clipboard after optimization</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Automatically copy the optimized gear set's export string to your clipboard when optimization completes.</p>
                    </div>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="lock-current-gear-slots-checkbox" ${this.lockCurrentGearSlots ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Lock current gear set slots</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Currently equipped items cannot be changed by the optimizer. Empty slots are still optimized normally.</p>
                    </div>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="include-pets-checkbox" ${this.includePets ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Include pets in optimization</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">The optimizer will try your owned pets at their current level to find the best one for the activity or recipe.</p>
                    </div>
                    
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="include-consumables-checkbox" ${this.includeConsumables ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Include consumables in optimization</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">The optimizer will try your owned consumables to find the best one for the activity or recipe.</p>
                    </div>
                    ${(window._featureFlags && window._featureFlags.local_optimization) ? `
                    <div style="margin-bottom: var(--spacing-md);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="run-local-optimization-checkbox" ${this.runLocalOptimization ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Run optimization locally</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Runs the optimizer in your browser instead of on the server. On a reasonably modern phone or computer this is usually faster, and it reduces server load. Older or low-end devices may be slower than the server. Results are identical to a server run, and once finished they're saved to the server, so they're available on all your devices.</p>
                        <label class="optimizer-checkbox" style="margin-top: var(--spacing-sm);">
                            <input type="checkbox" class="finish-on-server-checkbox" ${this.finishOnServerOnLeave ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Finish on server if I leave the page</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">If you close or leave the page while a local goals report is running, hand it off to the server to finish. Otherwise the run pauses until you return.</p>
                        <label class="optimizer-checkbox" style="margin-top: var(--spacing-sm);">
                            <input type="checkbox" class="disable-local-opt-warning-checkbox" ${this.disableLocalOptWarning ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Disable local optimization speed warning on all devices</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Stops the one-time "your device is faster than the server" popup, and the small speed test that powers it, on every device you use this account on.</p>
                    </div>
                    ` : ''}
                    

                    </div>
                </div>
                </div>
                
                <div class="setting-section">
                    ${collapsibleHeader('Activity Gear Set Optimization', 'activity')}
                    <div class="settings-collapsible-body" data-section="activity" style="${this.collapsedSections.activity ? 'display:none;' : ''}">
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    ">Each priority is an <strong>X per Y</strong> ratio (e.g. steps per target item, primary XP per step). Drag to reorder (top = highest priority). The eye icon toggles whether a priority shows up in the Quick panel.</p>

                    ${this.renderPresetBar('activity')}
                    <div class="xy-activity-mount" data-mount-id="settings-modal-activity"></div>
                    </div>
                </div>
                
                <div class="setting-section" style="margin-top: var(--spacing-xl);">
                    ${collapsibleHeader('Recipe Gear Set Optimization', 'recipe')}
                    <div class="settings-collapsible-body" data-section="recipe" style="${this.collapsedSections.recipe ? 'display:none;' : ''}">
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    ">Each priority is an <strong>X per Y</strong> ratio (e.g. materials per quality, xp per step) or a budget goal. Drag to reorder (top = highest priority). The eye icon toggles whether a priority shows up in the Quick panel.</p>

                    ${this.renderPresetBar('recipe')}
                    <div class="xy-recipe-mount" data-mount-id="settings-modal-recipe"></div>
                    </div>
                </div>

                <div class="setting-section" style="margin-top: var(--spacing-xl);">
                    ${collapsibleHeader('Travel Gear Set Optimization', 'travel')}
                    <div class="settings-collapsible-body" data-section="travel" style="${this.collapsedSections.travel ? 'display:none;' : ''}">
                    <p style="
                        color: var(--text-secondary);
                        font-size: 0.9em;
                        margin-bottom: var(--spacing-md);
                    ">Priorities for the column-3 traveling optimizer: <strong>Total Steps</strong> (minimize route steps) and <strong>Steps / Target Item</strong> (chests + item-finding drops you can trigger while traveling). Duplicate Steps / Target Item for multiple targets. Drag to reorder (top = highest priority).</p>

                    ${this.renderPresetBar('travel')}
                    <div class="travel-settings-mount" data-mount-id="settings-modal-travel"></div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render the Personalization tab content
     * @returns {string} HTML string
     */
    /**
     * Render the UI tab content
     * @returns {string} HTML string
     */
    renderUiTab() {
        const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
        const palette = ctSettings.line_colors || DEFAULT_PALETTE;
        const customColors = ctSettings.custom_colors || LINE_COLOR_PALETTES['Custom'];

        const paletteRowsHtml = Object.entries(LINE_COLOR_PALETTES).map(([name, colors]) => {
            const isSelected = palette === name;
            // For Custom, use saved colors instead of the default placeholder
            const displayColors = (name === 'Custom') ? customColors : colors;
            const dots = displayColors.map(c => `<span class="ct-palette-dot" style="background:${c}"></span>`).join('');
            return `<div class="ct-palette-row ${isSelected ? 'ct-palette-selected' : ''}" data-palette="${name}">
                <span class="ct-palette-name">${name}</span>
                <div class="ct-palette-dots">${dots}</div>
                ${isSelected ? '<span class="ct-palette-check">✓</span>' : ''}
            </div>`;
        }).join('');

        const customInputsHtml = customColors.map((c, i) =>
            `<label class="ct-custom-color-label" title="Depth ${i}">
                <input type="color" class="ct-custom-color" data-index="${i}" value="${c}">
                <span class="ct-custom-color-depth">${i}</span>
            </label>`
        ).join('');

        return `
            <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                <h3 class="settings-collapsible-header ${this.collapsedSections.popup ? 'collapsed' : ''}" data-section="popup">
                    <span class="expand-arrow ${this.collapsedSections.popup ? '' : 'expanded'}">▼</span>
                    Gear slot selection popup
                </h3>
                <div class="settings-collapsible-body" data-section="popup" style="${this.collapsedSections.popup ? 'display:none;' : ''}">
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <div style="display: flex; align-items: center; gap: var(--spacing-md); flex-wrap: wrap;">
                            <select class="popup-item-list-min-select" style="
                                background: var(--bg-tertiary);
                                color: var(--text-primary);
                                border: 1px solid var(--border-color);
                                border-radius: 4px;
                                padding: 4px 8px;
                            ">
                                <option value="0" ${this.popupItemListMin === 0 ? 'selected' : ''}>None</option>
                                ${[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(v =>
            `<option value="${v}" ${v === this.popupItemListMin ? 'selected' : ''}>${v}%</option>`
        ).join('')}
                            </select>
                            <label style="color: var(--text-primary); font-size: 0.9em;">Minimum height % for the item selection list</label>
                        </div>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 100px;
                            font-style: italic;
                        ">Forces the owned/equippable items list in gear slot popups to always be at least this tall, even when the top sections are fully expanded.</p>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="popup-auto-collapse-checkbox" ${this.popupAutoCollapseOnScroll ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Auto-collapse gear slot popup sections while scrolling</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">When scrolling the owned items list in a gear slot popup, the currently-equipped item stats and non-owned upgrades sections smoothly shrink to give the item list more room. They restore a few seconds after you stop scrolling. Only shrinks sections that are expanded.</p>
                        <div class="popup-auto-collapse-suboption" style="
                            margin-top: var(--spacing-sm);
                            margin-left: 26px;
                            display: ${this.popupAutoCollapseOnScroll ? 'block' : 'none'};
                        ">
                            <div style="display: flex; align-items: center; gap: var(--spacing-md); margin-bottom: var(--spacing-sm); flex-wrap: wrap;">
                                <select class="popup-auto-collapse-top-min-select" style="
                                    background: var(--bg-tertiary);
                                    color: var(--text-primary);
                                    border: 1px solid var(--border-color);
                                    border-radius: 4px;
                                    padding: 4px 8px;
                                ">
                                    ${[10, 15, 20, 25, 30, 35].map(v =>
            `<option value="${v}" ${v === this.popupAutoCollapseTopMin ? 'selected' : ''}>${v}%${v === 35 ? ' (no collapsing)' : ''}</option>`
        ).join('')}
                                </select>
                                <label style="color: var(--text-primary); font-size: 0.9em;">Minimum height % for equipped item</label>
                            </div>
                            <div style="display: flex; align-items: center; gap: var(--spacing-md); margin-bottom: var(--spacing-md); flex-wrap: wrap;">
                                <select class="popup-auto-collapse-alt-min-select" style="
                                    background: var(--bg-tertiary);
                                    color: var(--text-primary);
                                    border: 1px solid var(--border-color);
                                    border-radius: 4px;
                                    padding: 4px 8px;
                                ">
                                    ${[10, 15, 20, 25, 30, 35].map(v =>
            `<option value="${v}" ${v === this.popupAutoCollapseAltMin ? 'selected' : ''}>${v}%${v === 25 ? ' (no collapsing)' : ''}</option>`
        ).join('')}
                                </select>
                                <label style="color: var(--text-primary); font-size: 0.9em;">Minimum height % for non-owned/locked upgrades</label>
                            </div>
                            <label class="optimizer-checkbox">
                                <input type="checkbox" class="popup-auto-collapse-no-restore-checkbox" ${this.popupAutoCollapseNoRestore ? 'checked' : ''} />
                                <span class="optimizer-checkbox-label">Do not expand back afterwards</span>
                            </label>
                            <p style="
                                color: var(--text-muted);
                                font-size: 0.85em;
                                margin-top: var(--spacing-xs);
                                margin-left: 26px;
                                font-style: italic;
                            ">Once the sections have shrunk, keep them shrunk until you open the popup again.</p>
                        </div>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <div style="display: flex; align-items: center; gap: var(--spacing-md); flex-wrap: wrap;">
                            <select class="nonowned-upgrade-display-select" style="
                                background: var(--bg-tertiary);
                                color: var(--text-primary);
                                border: 1px solid var(--border-color);
                                border-radius: 4px;
                                padding: 4px 8px;
                                min-width: 200px;
                            ">
                                <option value="average" ${this.nonOwnedUpgradeDisplay === 'average' ? 'selected' : ''}>Average of all (default)</option>
                                <option value="percent" ${this.nonOwnedUpgradeDisplay === 'percent' ? 'selected' : ''}>Percent change (+/-%)</option>
                                <option value="list" ${this.nonOwnedUpgradeDisplay === 'list' ? 'selected' : ''}>List per item</option>
                            </select>
                            <label style="color: var(--text-primary); font-size: 0.9em;">Non-owned upgrade display</label>
                        </div>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">How the "Non-owned/Locked Upgrades" section in a gear slot popup shows an upgrade's value when the target is a category (e.g. Fine, Gems).<br/><b>Average of all</b> shows one old&nbsp;⟶&nbsp;new across every drop in the category;<br/><b>Percent change</b> shows that difference as a single +/-%;<br/><b>List per item</b> shows one line per individual drop (e.g. Fine ecto rock, Fine topaz) so you can compare them directly — this makes the blocks taller.</p>
                    </div>
                </div>
            </div>
            <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                <h3 class="settings-collapsible-header ${this.collapsedSections.misc ? 'collapsed' : ''}" data-section="misc">
                    <span class="expand-arrow ${this.collapsedSections.misc ? '' : 'expanded'}">▼</span>
                    Misc. UI Settings
                </h3>
                <div class="settings-collapsible-body" data-section="misc" style="${this.collapsedSections.misc ? 'display:none;' : ''}">
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="order-by-level-checkbox" ${this.orderByLevel ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Order activities and recipes by level</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Sort activities and recipes by level within each skill category. When unchecked, they are sorted alphabetically.</p>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="hide-unapplicable-stats-checkbox" ${this.hideUnapplicableStats ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Hide unapplicable stats in combined stats</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">When enabled, stats from items that don't apply to the current activity/location (including locked gated stats) are hidden from the combined stats breakdown.</p>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="use-wiki-dark-mode-checkbox" ${this.useWikiDarkMode ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Use wiki dark mode</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">When enabled, "Wiki" links open wiki.walkscape.app in its dark theme (adds <code>?usedarkmode=1</code> to the URL). Turn this off if you prefer the wiki's default theme.</p>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <label class="optimizer-checkbox">
                            <input type="checkbox" class="hotkeys-enabled-checkbox" ${this.hotkeysEnabled ? 'checked' : ''} />
                            <span class="optimizer-checkbox-label">Enable keyboard hotkeys</span>
                        </label>
                        <p style="
                            color: var(--text-muted);
                            font-size: 0.85em;
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            font-style: italic;
                        ">Press these keys (when not typing in a field) to quickly open panels:</p>
                        <div style="
                            margin-top: var(--spacing-xs);
                            margin-left: 26px;
                            display: grid;
                            grid-template-columns: auto 1fr;
                            gap: 2px 12px;
                            font-size: 0.85em;
                            color: var(--text-muted);
                        ">
                            <kbd class="hotkey-badge">A</kbd><span>Announcements</span>
                            <kbd class="hotkey-badge">B</kbd><span>Bug Report</span>
                            <kbd class="hotkey-badge">S</kbd><span>Settings</span>
                            <kbd class="hotkey-badge">I</kbd> <span>Info / About</span>
                            <kbd class="hotkey-badge">H</kbd><span>Help</span>
                            ${window._featureFlags?.travel ? `<kbd class="hotkey-badge">T</kbd><span>Travel</span>` : ''}
                            ${window._featureFlags?.crafting_tree ? `<kbd class="hotkey-badge">C</kbd><span>Crafting Tree</span>` : ''}
                            ${window._featureFlags?.stats_report ? `<kbd class="hotkey-badge">O</kbd><span>Optimized Goals Report</span>` : ''}
                            ${window._featureFlags?.sell_for_chips ? `<kbd class="hotkey-badge">M</kbd><span>Sell for Chips</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
            <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                <h3 class="settings-collapsible-header ${this.collapsedSections.numberFormat ? 'collapsed' : ''}" data-section="numberFormat">
                    <span class="expand-arrow ${this.collapsedSections.numberFormat ? '' : 'expanded'}">▼</span>
                    Number formatting
                </h3>
                <div class="settings-collapsible-body" data-section="numberFormat" style="${this.collapsedSections.numberFormat ? 'display:none;' : ''}">
                    <p style="color: var(--text-muted); font-size: 0.85em; margin-bottom: var(--spacing-sm); font-style: italic;">
                        Affects every number shown in the app — stats, steps, costs, target yields, every column in every tab.
                    </p>
                    <div class="setting-row" style="margin-bottom: var(--spacing-md); display: flex; align-items: center; gap: var(--spacing-md); flex-wrap: wrap;">
                        <label style="color: var(--text-primary); font-size: 0.9em; min-width: 140px;">Thousand separator</label>
                        <select class="number-format-thousand-select" style="
                            background: var(--bg-tertiary);
                            color: var(--text-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            padding: 4px 8px;
                            min-width: 200px;
                        ">
                            <option value="," ${this.numberFormat.thousand === ',' ? 'selected' : ''}>Comma — 1,234,567 (default)</option>
                            <option value="." ${this.numberFormat.thousand === '.' ? 'selected' : ''}>Period — 1.234.567</option>
                            <option value=" " ${this.numberFormat.thousand === ' ' ? 'selected' : ''}>Space — 1 234 567</option>
                            <option value="'" ${this.numberFormat.thousand === "'" ? 'selected' : ''}>Apostrophe — 1'234'567</option>
                        </select>
                    </div>
                    <div class="setting-row" style="margin-bottom: var(--spacing-md); display: flex; align-items: center; gap: var(--spacing-md); flex-wrap: wrap;">
                        <label style="color: var(--text-primary); font-size: 0.9em; min-width: 140px;">Decimal separator</label>
                        <select class="number-format-decimal-select" style="
                            background: var(--bg-tertiary);
                            color: var(--text-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            padding: 4px 8px;
                            min-width: 200px;
                        ">
                            <option value="." ${this.numberFormat.decimal === '.' ? 'selected' : ''}>Period — 3.14 (default)</option>
                            <option value="," ${this.numberFormat.decimal === ',' ? 'selected' : ''}>Comma — 3,14</option>
                        </select>
                    </div>
                    <p class="number-format-preview" style="color: var(--text-secondary); font-size: 0.9em; margin-top: var(--spacing-sm); font-family: monospace;">
                        Preview: ${this._renderNumberFormatPreview()}
                    </p>
                    <p style="color: var(--text-muted); font-size: 0.8em; margin-top: var(--spacing-xs); font-style: italic;">
                        The thousand and decimal separators must differ. If you pick the same character for both, the thousand separator is automatically switched.
                    </p>
                </div>
            </div>
            ${window._featureFlags?.crafting_tree ? `
            <div class="setting-section" style="margin-bottom: var(--spacing-lg);">
                <h3 class="settings-collapsible-header ${this.collapsedSections.themeColors ? 'collapsed' : ''}" data-section="themeColors">
                    <span class="expand-arrow ${this.collapsedSections.themeColors ? '' : 'expanded'}">▼</span>
                    Section theme colors
                </h3>
                <div class="settings-collapsible-body" data-section="themeColors" style="${this.collapsedSections.themeColors ? 'display:none;' : ''}">
                    <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                        <p style="color: var(--text-muted); font-size: 0.85em; margin-bottom: var(--spacing-sm); font-style: italic;">
                            Colors for the depth lines in the crafting tree.
                        </p>
                        <div class="ct-palette-list">
                            ${paletteRowsHtml}
                        </div>
                        <div class="ct-custom-colors ${palette === 'Custom' ? '' : 'ct-hidden'}">
                            <div class="ct-custom-colors-row">
                                ${customInputsHtml}
                            </div>
                            ${this._renderColorPresetManager()}
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}
        `;
    }

    // ---- Color Preset Helpers ----

    async _loadColorPresets() {
        try {
            this.colorPresets = await api.getColorPresets();
        } catch {
            this.colorPresets = [];
        }
    }

    _renderColorPresetDropdownContent() {
        const search = (this._colorPresetSearch || '').toLowerCase();
        const presets = (this.colorPresets || []).filter(p =>
            !search || p.name.toLowerCase().includes(search)
        );
        const searchInput = `<input type="text" class="gear-set-search color-preset-search" placeholder="Search palettes..." value="${this._colorPresetSearch || ''}" />`;
        const newThemeBtn = `<div class="color-preset-new" style="padding:6px 10px;cursor:pointer;color:#4ade80;font-weight:500;border-bottom:1px solid var(--border-color);">+ New Theme</div>`;
        const emptyMsg = '<div style="padding:8px;color:var(--text-secondary);font-size:0.85em;">No saved palettes</div>';
        const listHtml = presets.length === 0 ? emptyMsg : presets.map(p => {
            const isPending = this._colorPresetPendingDelete === p.id.toString();
            return `<div class="color-preset-item" data-preset-id="${p.id}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border-color);">
                <span style="font-size:0.9em">${p.name}</span>
                <button class="${isPending ? 'delete-confirm' : 'delete-button'} color-preset-delete" data-preset-id="${p.id}">${isPending ? 'Delete?' : '×'}</button>
            </div>`;
        }).join('');
        return searchInput + newThemeBtn + listHtml;
    }

    _captureCurrentTheme(name) {
        const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
        return {
            name,
            lineColors: ctSettings.line_colors || DEFAULT_PALETTE,
            customColors: ctSettings.custom_colors || null,
        };
    }

    _applyColorPreset(preset) {
        const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
        const updated = { ...ctSettings };
        if (preset.lineColors) updated.line_colors = preset.lineColors;
        if (preset.customColors) updated.custom_colors = preset.customColors;
        store.update('ui.crafting_tree.global_settings', updated);
        const sessionUuid = store.get('session.uuid');
        if (sessionUuid) api.updateConfig(sessionUuid, 'ui.crafting_tree.global_settings', updated);
        _applyCraftingTreeColors(updated);

        // Update the color picker inputs and palette dots in the DOM
        if (preset.customColors) {
            preset.customColors.forEach((c, i) => {
                this.$element.find(`.ct-custom-color[data-index="${i}"]`).val(c);
                this.$element.find(`.ct-palette-row[data-palette="Custom"] .ct-palette-dots .ct-palette-dot:nth-child(${i + 1})`).css('background', c);
            });
        }
    }

    _renderColorPresetManager() {
        const dropdownOpen = this._colorPresetDropdownOpen || false;
        const currentName = this._colorPresetName || '';
        const hasName = currentName.trim().length > 0;
        const arrowIcon = `<span class="expand-arrow ${dropdownOpen ? 'expanded' : ''}">▼</span>`;

        return `
            <div class="gear-set-manager color-preset-manager" style="margin-top:var(--spacing-sm);">
                <div class="gear-set-header">
                    <button class="save-button color-preset-save-btn" ${hasName ? '' : 'disabled'}>Save</button>
                    <div class="gear-set-dropdown-button">
                        <input type="text" class="gear-set-name-input color-preset-name-input" placeholder="New Palette" value="${currentName}" maxlength="60" />
                        <button class="dropdown-toggle color-preset-dropdown-toggle">${arrowIcon}</button>
                    </div>
                </div>
                <div class="gear-set-dropdown color-preset-dropdown" style="display:${dropdownOpen ? 'block' : 'none'};">
                    ${this._renderColorPresetDropdownContent()}
                </div>
                <div style="display:flex;gap:var(--spacing-sm);margin-top:var(--spacing-xs);">
                    <button class="button color-preset-export-btn" style="flex:1;font-size:0.85em;">Export</button>
                    <button class="button color-preset-import-btn" style="flex:1;font-size:0.85em;">Import</button>
                </div>
            </div>
        `;
    }

    renderPersonalizationTab() {
        return `
            ${this._renderNotificationsSection()}
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Background Tertiary Color: (weird locations for now)</label>
                <div style="display: flex; gap: var(--spacing-sm); align-items: center;">
                    <input 
                        type="color" 
                        class="color-picker-tertiary" 
                        value="${this.customColorTertiary}"
                        style="
                            width: 60px;
                            height: 40px;
                            padding: 2px;
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            cursor: pointer;
                        "
                    >
                    <input 
                        type="text" 
                        class="color-text-input-tertiary" 
                        value="${this.customColorTertiary}"
                        placeholder="#0f0f14"
                        maxlength="7"
                        style="
                            flex: 1;
                            padding: var(--spacing-sm);
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            color: var(--text-primary);
                            font-family: monospace;
                            font-size: 0.9em;
                        "
                    >
                </div>
                <div style="
                    margin-top: var(--spacing-sm);
                    padding: var(--spacing-sm);
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-secondary);
                    font-size: 0.85em;
                ">
                    Used for column headers, buttons, and other tertiary background elements.
                </div>
            </div>
            <div class="setting-row" style="margin-bottom: var(--spacing-lg);">
                <label style="
                    display: block;
                    margin-bottom: var(--spacing-sm);
                    color: var(--text-secondary);
                    font-weight: 500;
                ">Background Hover Color:</label>
                <div style="display: flex; gap: var(--spacing-sm); align-items: center;">
                    <input 
                        type="color" 
                        class="color-picker-hover" 
                        value="${this.customColorHover}"
                        style="
                            width: 60px;
                            height: 40px;
                            padding: 2px;
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            cursor: pointer;
                        "
                    >
                    <input 
                        type="text" 
                        class="color-text-input-hover" 
                        value="${this.customColorHover}"
                        placeholder="#333333"
                        maxlength="7"
                        style="
                            flex: 1;
                            padding: var(--spacing-sm);
                            background-color: var(--bg-primary);
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            color: var(--text-primary);
                            font-family: monospace;
                            font-size: 0.9em;
                        "
                    >
                </div>
                <div style="
                    margin-top: var(--spacing-sm);
                    padding: var(--spacing-sm);
                    background-color: var(--bg-primary);
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    color: var(--text-secondary);
                    font-size: 0.85em;
                ">
                    Used for hover states on buttons, items, and interactive elements.
                </div>
            </div>
            <div class="setting-row">
                <button 
                    class="button button-primary reset-color-btn" 
                    style="width: 100%;"
                >
                    Reset All to Default
                </button>
            </div>
            <div class="setting-row" style="display:flex; gap: var(--spacing-sm); margin-top: var(--spacing-sm);">
                <button class="button theme-export-btn" style="flex:1">Export Theme</button>
                <button class="button theme-import-btn" style="flex:1">Import Theme</button>
            </div>
            ${window._featureFlags?.april_fools ? `
            <div class="setting-row" style="margin-top: var(--spacing-lg); border-top: 1px solid var(--border-color); padding-top: var(--spacing-lg);">
                <p style="color: var(--text-secondary); font-weight: 500; margin-bottom: var(--spacing-sm);">🎉 April Fools Mode</p>
                <label class="optimizer-checkbox" style="margin-bottom: var(--spacing-sm);">
                    <input type="checkbox" class="april-fools-animations-checkbox" ${this.aprilFoolsAnimations ? 'checked' : ''} />
                    <span class="optimizer-checkbox-label">Icon Chaos (animations)</span>
                </label>
                <label class="optimizer-checkbox">
                    <input type="checkbox" class="april-fools-text-checkbox" ${this.aprilFoolsText ? 'checked' : ''} />
                    <span class="optimizer-checkbox-label">Silly Names &amp; Notifications (text)</span>
                </label>
                <p style="
                    color: var(--text-muted);
                    font-size: 0.85em;
                    margin-top: var(--spacing-xs);
                    margin-left: 26px;
                    font-style: italic;
                ">Both auto-enable on April 1st.</p>
            </div>
            ` : ''}
        `;
    }

    // ========================================================================
    // PUSH NOTIFICATION HELPERS
    // ========================================================================

    /**
     * Detect if running as a PWA (standalone mode).
     * @returns {boolean}
     */
    isPwa() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    /**
     * Detect if running on iOS.
     * @returns {boolean}
     */
    isIos() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    /**
     * Check if push notifications are supported.
     * @returns {boolean}
     */
    pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window;
    }

    /**
     * Render the Notifications section for the Personalization tab.
     * @returns {string} HTML string
     */
    _renderNotificationsSection() {
        const supported = this.pushSupported();
        const ios = this.isIos();
        const pwa = this.isPwa();
        const permission = this._pushPermission;
        const sub = this._pushSubscription;
        const prefs = this._pushPrefs;

        let content = '';

        if (!supported) {
            content = `<p style="color:var(--text-muted);font-size:0.9em;">Push notifications are not supported on this browser.</p>`;
        } else if (ios && !pwa) {
            content = `
                <p style="color:var(--text-secondary);font-size:0.9em;margin-bottom:var(--spacing-sm);">
                    To enable notifications on iOS, install this app to your home screen first:
                </p>
                <ol style="color:var(--text-muted);font-size:0.85em;padding-left:1.2em;margin:0;">
                    <li>Tap the <strong>Share</strong> button in Safari</li>
                    <li>Select <strong>Add to Home Screen</strong></li>
                    <li>Open the app from your home screen</li>
                    <li>Return here to enable notifications</li>
                </ol>
            `;
        } else if (permission === 'denied') {
            content = `<p style="color:var(--text-muted);font-size:0.9em;">Notifications are blocked. Re-enable them in your browser settings, then reload.</p>`;
        } else if (permission === 'default') {
            content = `
                <p style="color:var(--text-secondary);font-size:0.9em;margin-bottom:var(--spacing-sm);">
                    Get notified when new announcements are posted.
                </p>
                <button class="button button-primary push-enable-btn" style="width:100%;">
                    🔔 Enable Notifications
                </button>
            `;
        } else if (permission === 'granted' && !sub) {
            if (this._pushConfigError) {
                content = `
                    <p style="color:var(--text-muted);font-size:0.9em;">
                        ⚠️ Push notifications are not configured on the server yet. Check back after the next deploy.
                    </p>
                `;
            } else if (this._pushInitError) {
                content = `
                    <p style="color:var(--text-muted);font-size:0.9em;margin-bottom:var(--spacing-sm);">
                        ⚠️ Couldn't set up notifications on this device: ${this._pushInitError}
                    </p>
                    <button class="button button-primary push-enable-btn" style="width:100%;">
                        Try again
                    </button>
                `;
            } else {
                content = `
                    <p style="color:var(--text-muted);font-size:0.9em;">
                        ${this._pushLoading ? 'Setting up notifications…' : 'Notifications enabled. Loading preferences…'}
                    </p>
                `;
            }
        } else if (permission === 'granted' && sub) {
            const globalChecked = prefs.global_announcements ? 'checked' : '';
            const targetedChecked = prefs.targeted_announcements ? 'checked' : '';
            content = `
                <label class="optimizer-checkbox" style="margin-bottom:var(--spacing-sm);">
                    <input type="checkbox" class="push-pref-global" ${globalChecked} />
                    <span class="optimizer-checkbox-label">Global announcements</span>
                </label>
                <p style="color:var(--text-muted);font-size:0.8em;margin:0 0 var(--spacing-sm) 26px;font-style:italic;">
                    Big feature releases and major updates, sent to everyone.
                </p>
                <label class="optimizer-checkbox" style="margin-bottom:var(--spacing-sm);">
                    <input type="checkbox" class="push-pref-targeted" ${targetedChecked} />
                    <span class="optimizer-checkbox-label">Personal notifications</span>
                </label>
                <p style="color:var(--text-muted);font-size:0.8em;margin:0 0 0 26px;font-style:italic;">
                    Responses to your bug reports, fixes for issues you reported, and other messages just for you.
                </p>
            `;
        }

        return `
            <div class="setting-row push-notifications-section" style="margin-bottom:var(--spacing-lg);padding-bottom:var(--spacing-lg);border-bottom:1px solid var(--border-color);">
                <label style="display:block;margin-bottom:var(--spacing-sm);color:var(--text-secondary);font-weight:500;">
                    Notifications
                </label>
                ${content}
            </div>
        `;
    }

    /**
     * Initialize push notifications: fetch VAPID key, subscribe, load preferences.
     */
    async _initPushNotifications() {
        if (this._pushLoading) return;
        this._pushLoading = true;
        this._pushInitError = null;
        try {
            // Fetch VAPID public key
            const keyResp = await fetch('/api/push/vapid-public-key');
            const keyData = await keyResp.json();
            if (keyData.error || !keyData.public_key) {
                this._pushLoading = false;
                this._pushConfigError = true;
                this.render();
                this.attachEvents();
                return;
            }
            this._pushVapidKey = keyData.public_key;

            // Get service worker registration
            const reg = await navigator.serviceWorker.ready;

            // Check for existing subscription
            let sub = await reg.pushManager.getSubscription();

            if (!sub) {
                // Convert base64url key to Uint8Array
                const rawKey = this._urlBase64ToUint8Array(this._pushVapidKey);
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: rawKey,
                });

                // POST subscription to server
                const subJson = sub.toJSON();
                await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: subJson.endpoint,
                        p256dh: subJson.keys.p256dh,
                        auth: subJson.keys.auth,
                    }),
                });
            }

            this._pushSubscription = sub;

            // Load preferences — if this is a fresh subscription, auto-enable both
            const prefResp = await fetch('/api/push/preferences');
            this._pushPrefs = await prefResp.json();

            // Auto-enable both on first subscribe (when neither is set yet)
            if (!this._pushPrefs.global_announcements && !this._pushPrefs.targeted_announcements) {
                this._pushPrefs = { global_announcements: true, targeted_announcements: true };
                await fetch('/api/push/preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this._pushPrefs),
                });
            }

        } catch (e) {
            console.error('Push init failed:', e);
            api.showError('Failed to enable notifications: ' + (e.message || e));
            this._pushInitError = e.message || String(e);
        }
        this._pushLoading = false;
        this.render();
        this.attachEvents();
    }

    /**
     * Save push preferences (debounced).
     */
    _savePushPreferences() {
        clearTimeout(this._pushPrefSaveTimer);
        this._pushPrefSaveTimer = setTimeout(async () => {
            try {
                await fetch('/api/push/preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this._pushPrefs),
                });
            } catch (e) {
                console.error('Failed to save push preferences:', e);
            }
        }, 2000);
    }

    /**
     * Convert a base64url string to a Uint8Array (for VAPID applicationServerKey).
     * @param {string} base64String
     * @returns {Uint8Array}
     */
    _urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    /**
     * Show onboarding nudge for push notifications (once per user).
     */
    _showPushNudgeIfNeeded() {
        if (localStorage.getItem('push_nudge_seen')) return;
        localStorage.setItem('push_nudge_seen', '1');

        // Highlight the Notifications section briefly
        const $section = this.$element.find('.push-notifications-section');
        if ($section.length) {
            $section.css({
                'outline': '2px solid var(--accent-primary)',
                'outline-offset': '4px',
                'border-radius': '4px',
                'transition': 'outline 0.3s ease',
            });
            setTimeout(() => {
                $section.css('outline', 'none');
            }, 3000);
        }
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Remove any existing handlers first
        this.$element.off();
        $(document).off('keydown.settings-modal');

        // Tab switching - just toggle visibility, don't re-render
        this.$element.on('click', '.settings-tab', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const tab = $(e.currentTarget).data('tab');
            if (tab !== this.activeTab) {
                this.activeTab = tab;

                // Update active class on tabs
                this.$element.find('.settings-tab').removeClass('active');
                $(e.currentTarget).addClass('active');

                // Show/hide tab content
                this.$element.find('.tab-content').hide();
                this.$element.find(`.${tab}-tab`).show();

                // Load color presets when UI tab is opened
                if (tab === 'ui') {
                    this._loadColorPresets().then(() => {
                        this.$element.find('.color-preset-dropdown').html(this._renderColorPresetDropdownContent());
                    });
                }
            }
            return false;
        });

        // Close button
        this.$element.on('click', '.close-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            return false;
        });

        // Click outside modal to close - be more specific
        this.$element.on('click', '.modal-overlay', (e) => {
            // Only close if clicking directly on the overlay, not on any child elements
            if (e.target === e.currentTarget) {
                this.hide();
            }
        });

        // Switch session button
        this.$element.on('click', '.switch-session-btn', () => {
            this.handleSwitchSession();
        });

        // Enter key in input
        this.$element.on('keypress', '.uuid-input', (e) => {
            if (e.which === 13) { // Enter key
                this.handleSwitchSession();
            }
        });

        // Export config button
        this.$element.on('click', '.export-config-btn', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.handleExportConfig();
        });

        // Clear error when user starts typing
        this.$element.on('input', '.uuid-input', () => {
            if (this.errorMessage) {
                this.errorMessage = '';
                this.render();
                this.attachEvents();
            }
        });

        // Order by level checkbox
        this.$element.on('change', '.order-by-level-checkbox', (e) => {
            this.orderByLevel = e.target.checked;
            localStorage.setItem('orderActivitiesByLevel', this.orderByLevel.toString());
            window.dispatchEvent(new CustomEvent('orderByLevelChanged', { detail: { value: this.orderByLevel } }));
        });

        // Hide unapplicable stats checkbox
        this.$element.on('change', '.hide-unapplicable-stats-checkbox', (e) => {
            this.hideUnapplicableStats = e.target.checked;
            localStorage.setItem('hideUnapplicableStats', this.hideUnapplicableStats.toString());
            window.dispatchEvent(new CustomEvent('hideUnapplicableStatsChanged', { detail: { value: this.hideUnapplicableStats } }));
        });

        // Use wiki dark mode checkbox
        this.$element.on('change', '.use-wiki-dark-mode-checkbox', (e) => {
            this.useWikiDarkMode = e.target.checked;
            localStorage.setItem('useWikiDarkMode', this.useWikiDarkMode.toString());
            window.dispatchEvent(new CustomEvent('useWikiDarkModeChanged', { detail: { value: this.useWikiDarkMode } }));
        });

        // Popup auto-collapse on scroll checkbox
        this.$element.on('change', '.popup-auto-collapse-checkbox', (e) => {
            this.popupAutoCollapseOnScroll = e.target.checked;
            localStorage.setItem('popupAutoCollapseOnScroll', this.popupAutoCollapseOnScroll.toString());
            window.dispatchEvent(new CustomEvent('popupAutoCollapseOnScrollChanged', { detail: { value: this.popupAutoCollapseOnScroll } }));
            // Slide the sub-option row in/out
            const $sub = this.$element.find('.popup-auto-collapse-suboption');
            if (this.popupAutoCollapseOnScroll) {
                $sub.stop(true, false).slideDown(200);
            } else {
                $sub.stop(true, false).slideUp(200);
            }
        });

        // Popup auto-collapse: do not expand back sub-option
        this.$element.on('change', '.popup-auto-collapse-no-restore-checkbox', (e) => {
            this.popupAutoCollapseNoRestore = e.target.checked;
            localStorage.setItem('popupAutoCollapseNoRestore', this.popupAutoCollapseNoRestore.toString());
            window.dispatchEvent(new CustomEvent('popupAutoCollapseNoRestoreChanged', { detail: { value: this.popupAutoCollapseNoRestore } }));
        });

        // Popup auto-collapse min-height for equipped item section
        this.$element.on('change', '.popup-auto-collapse-top-min-select', (e) => {
            const v = parseInt(e.target.value, 10);
            this.popupAutoCollapseTopMin = v;
            localStorage.setItem('popupAutoCollapseTopMin', v.toString());
            document.documentElement.style.setProperty('--popup-auto-collapse-top-min', `${v}vh`);
        });

        // Popup auto-collapse min-height for non-owned/locked upgrades section
        this.$element.on('change', '.popup-auto-collapse-alt-min-select', (e) => {
            const v = parseInt(e.target.value, 10);
            this.popupAutoCollapseAltMin = v;
            localStorage.setItem('popupAutoCollapseAltMin', v.toString());
            document.documentElement.style.setProperty('--popup-auto-collapse-alt-min', `${v}vh`);
        });

        // Popup item list minimum height (independent of auto-collapse)
        this.$element.on('change', '.popup-item-list-min-select', (e) => {
            const v = parseInt(e.target.value, 10);
            this.popupItemListMin = v;
            localStorage.setItem('popupItemListMin', v.toString());
            if (v === 0) {
                document.documentElement.style.removeProperty('--popup-item-list-min');
            } else {
                document.documentElement.style.setProperty('--popup-item-list-min', `${v}vh`);
            }
        });

        // Non-owned upgrade display mode (gear slot popup upgrades section)
        this.$element.on('change', '.nonowned-upgrade-display-select', (e) => {
            const v = e.target.value;
            this.nonOwnedUpgradeDisplay = (v === 'percent' || v === 'list') ? v : 'average';
            localStorage.setItem('nonOwnedUpgradeDisplay', this.nonOwnedUpgradeDisplay);
            // Apply immediately: any open gear slot popup re-renders its
            // alternatives section on this event.
            window.dispatchEvent(new CustomEvent('nonOwnedUpgradeDisplayChanged', {
                detail: { value: this.nonOwnedUpgradeDisplay },
            }));
        });

        // Hotkeys enabled checkbox
        this.$element.on('change', '.hotkeys-enabled-checkbox', (e) => {
            this.hotkeysEnabled = e.target.checked;
            localStorage.setItem('hotkeysEnabled', this.hotkeysEnabled.toString());
            window.dispatchEvent(new CustomEvent('hotkeysEnabledChanged', { detail: { value: this.hotkeysEnabled } }));
        });

        // Number formatting — thousand separator
        this.$element.on('change', '.number-format-thousand-select', (e) => {
            const eff = setNumberFormatPrefs({ thousand: e.target.value });
            this.numberFormat = eff;
            // The setter may have flipped the decimal-conflicting choice;
            // sync the visible <select> values back to the effective prefs.
            this.$element.find('.number-format-thousand-select').val(eff.thousand);
            this.$element.find('.number-format-decimal-select').val(eff.decimal);
            this.$element.find('.number-format-preview').text(`Preview: ${this._renderNumberFormatPreview()}`);
        });

        // Number formatting — decimal separator
        this.$element.on('change', '.number-format-decimal-select', (e) => {
            const eff = setNumberFormatPrefs({ decimal: e.target.value });
            this.numberFormat = eff;
            this.$element.find('.number-format-thousand-select').val(eff.thousand);
            this.$element.find('.number-format-decimal-select').val(eff.decimal);
            this.$element.find('.number-format-preview').text(`Preview: ${this._renderNumberFormatPreview()}`);
        });

        // Crafting tree palette row click
        this.$element.on('click', '.ct-palette-row', (e) => {
            const name = $(e.currentTarget).data('palette');
            this.$element.find('.ct-palette-row').removeClass('ct-palette-selected')
                .find('.ct-palette-check').remove();
            $(e.currentTarget).addClass('ct-palette-selected')
                .append('<span class="ct-palette-check">✓</span>');
            if (name === 'Custom') {
                this.$element.find('.ct-custom-colors').removeClass('ct-hidden');
            } else {
                this.$element.find('.ct-custom-colors').addClass('ct-hidden');
            }
            this._savePaletteSettings();
        });

        // Crafting tree custom color input
        this.$element.on('input', '.ct-custom-color', (e) => {
            const idx = $(e.target).data('index');
            const color = $(e.target).val();
            // Update the dot in the Custom palette row
            this.$element.find(`.ct-palette-row[data-palette="Custom"] .ct-palette-dots .ct-palette-dot:nth-child(${idx + 1})`).css('background', color);
            this._savePaletteSettings();
        });

        // April Fools toggles
        this.$element.on('change', '.april-fools-animations-checkbox', (e) => {
            this.aprilFoolsAnimations = e.target.checked;
            setAnimationsEnabled(this.aprilFoolsAnimations);
            this._persistAprilFoolsState();
        });
        this.$element.on('change', '.april-fools-text-checkbox', (e) => {
            this.aprilFoolsText = e.target.checked;
            setTextEnabled(this.aprilFoolsText);
            this._persistAprilFoolsState();
        });

        // Color picker change - tertiary
        this.$element.on('input', '.color-picker-tertiary', (e) => {
            const color = $(e.target).val();
            this.$element.find('.color-text-input-tertiary').val(color);
            this.saveCustomColor('customBgTertiary', '--bg-tertiary', color);
        });

        // Color text input change - tertiary
        this.$element.on('input', '.color-text-input-tertiary', (e) => {
            const color = $(e.target).val();
            // Validate hex color format
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                this.$element.find('.color-picker-tertiary').val(color);
                this.saveCustomColor('customBgTertiary', '--bg-tertiary', color);
            }
        });

        // Color picker change - hover
        this.$element.on('input', '.color-picker-hover', (e) => {
            const color = $(e.target).val();
            this.$element.find('.color-text-input-hover').val(color);
            this.saveCustomColor('customBgHover', '--bg-hover', color);
        });

        // Color text input change - hover
        this.$element.on('input', '.color-text-input-hover', (e) => {
            const color = $(e.target).val();
            // Validate hex color format
            if (/^#[0-9A-F]{6}$/i.test(color)) {
                this.$element.find('.color-picker-hover').val(color);
                this.saveCustomColor('customBgHover', '--bg-hover', color);
            }
        });

        // Reset color button
        this.$element.on('click', '.reset-color-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const defaultTertiary = '#0f0f14';
            const defaultHover = '#333333';

            this.saveCustomColor('customBgTertiary', '--bg-tertiary', defaultTertiary);
            this.saveCustomColor('customBgHover', '--bg-hover', defaultHover);

            // Update the inputs
            this.$element.find('.color-picker-tertiary').val(defaultTertiary);
            this.$element.find('.color-text-input-tertiary').val(defaultTertiary);
            this.$element.find('.color-picker-hover').val(defaultHover);
            this.$element.find('.color-text-input-hover').val(defaultHover);

            return false;
        });

        // Export theme — bundle all color settings into a gzip+base64 string
        this.$element.on('click', '.theme-export-btn', (e) => {
            e.preventDefault();
            const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
            const theme = {
                v: 1,
                bgTertiary: localStorage.getItem('customBgTertiary') || '#0f0f14',
                bgHover: localStorage.getItem('customBgHover') || '#333333',
                lineColors: ctSettings.line_colors || null,
                customColors: ctSettings.custom_colors || null,
            };
            try {
                const json = JSON.stringify(theme);
                const bytes = new TextEncoder().encode(json);
                const compressed = window.pako.gzip(bytes);
                const b64 = btoa(String.fromCharCode(...compressed));
                navigator.clipboard.writeText(b64).then(() => {
                    api.showSuccess('Theme copied to clipboard');
                }).catch(() => {
                    prompt('Copy this theme string:', b64);
                });
            } catch (err) {
                api.showError('Failed to export theme');
            }
        });

        // Import theme — decode gzip+base64 string and apply all color settings
        this.$element.on('click', '.theme-import-btn', async (e) => {
            e.preventDefault();
            let b64;
            try {
                b64 = await navigator.clipboard.readText();
            } catch {
                b64 = prompt('Paste a theme string:');
            }
            if (!b64 || !b64.trim()) return;
            try {
                const binary = atob(b64.trim());
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const decompressed = window.pako.ungzip(bytes, { to: 'string' });
                const theme = JSON.parse(decompressed);
                if (theme.v !== 1) throw new Error('Unknown theme version');

                // Apply background colors
                if (theme.bgTertiary) {
                    this.saveCustomColor('customBgTertiary', '--bg-tertiary', theme.bgTertiary);
                    this.$element.find('.color-picker-tertiary').val(theme.bgTertiary);
                    this.$element.find('.color-text-input-tertiary').val(theme.bgTertiary);
                }
                if (theme.bgHover) {
                    this.saveCustomColor('customBgHover', '--bg-hover', theme.bgHover);
                    this.$element.find('.color-picker-hover').val(theme.bgHover);
                    this.$element.find('.color-text-input-hover').val(theme.bgHover);
                }

                // Apply crafting tree line colors
                if (theme.lineColors || theme.customColors) {
                    const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
                    const updated = { ...ctSettings };
                    if (theme.lineColors) updated.line_colors = theme.lineColors;
                    if (theme.customColors) updated.custom_colors = theme.customColors;
                    store.update('ui.crafting_tree.global_settings', updated);
                    const sessionUuid = store.get('session.uuid');
                    if (sessionUuid) api.updateConfig(sessionUuid, 'ui.crafting_tree.global_settings', updated);
                    // Re-apply crafting tree colors
                    _applyCraftingTreeColors(updated);
                }

                api.showSuccess('Theme applied');
            } catch (err) {
                api.showError('Invalid theme string');
            }
        });

        // Color preset name input
        this.$element.on('input', '.color-preset-name-input', (e) => {
            this._colorPresetName = $(e.target).val();
            const hasName = this._colorPresetName.trim().length > 0;
            this.$element.find('.color-preset-save-btn').prop('disabled', !hasName);
        });

        // Color preset save — uses API, updates name if preset already selected
        this.$element.on('click', '.color-preset-save-btn', async (e) => {
            e.preventDefault();
            const name = (this._colorPresetName || '').trim();
            if (!name) return;
            const theme = this._captureCurrentTheme(name);
            try {
                // Pass current selected ID so backend updates by ID (rename support)
                const saved = await api.saveColorPreset(name, theme.lineColors, theme.customColors, this._selectedColorPresetId || null);
                this._selectedColorPresetId = saved.id;
                this._colorPresetName = saved.name;
                this.$element.find('.color-preset-name-input').val(saved.name);
                await this._loadColorPresets();
                // Re-render dropdown in place
                const $dd = this.$element.find('.color-preset-dropdown');
                $dd.html(this._renderColorPresetDropdownContent());
                api.showSuccess(`Saved "${saved.name}"`);
            } catch { api.showError('Failed to save palette'); }
        });

        // Color preset dropdown toggle
        this.$element.on('click', '.color-preset-dropdown-toggle', (e) => {
            e.preventDefault();
            this._colorPresetDropdownOpen = !this._colorPresetDropdownOpen;
            const $dd = this.$element.find('.color-preset-dropdown');
            const $arrow = this.$element.find('.color-preset-dropdown-toggle .expand-arrow');
            if (this._colorPresetDropdownOpen) {
                this._colorPresetSearch = '';
                $dd.html(this._renderColorPresetDropdownContent());
                $arrow.addClass('expanded');
                $dd.slideDown(150, () => {
                    $dd.find('.color-preset-search').focus();
                });
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(150);
            }
        });

        // Color preset search
        this.$element.on('input', '.color-preset-search', (e) => {
            this._colorPresetSearch = $(e.target).val();
            const $dd = this.$element.find('.color-preset-dropdown');
            const scrollTop = $dd.scrollTop();
            $dd.html(this._renderColorPresetDropdownContent());
            // Restore focus and cursor
            const $input = $dd.find('.color-preset-search');
            $input.focus();
            $input[0]?.setSelectionRange(this._colorPresetSearch.length, this._colorPresetSearch.length);
            $dd.scrollTop(scrollTop);
        });

        // Color preset load (click on item name)
        this.$element.on('click', '.color-preset-item', (e) => {
            if ($(e.target).closest('.color-preset-delete').length) return;
            const id = $(e.currentTarget).data('preset-id').toString();
            const preset = (this.colorPresets || []).find(p => p.id.toString() === id);
            if (!preset) return;
            this._applyColorPreset(preset);
            // Fill name input and track selected ID (like gear set manager)
            this._colorPresetName = preset.name;
            this._selectedColorPresetId = preset.id;
            this.$element.find('.color-preset-name-input').val(preset.name);
            this.$element.find('.color-preset-save-btn').prop('disabled', false);
            this._colorPresetDropdownOpen = false;
            this.$element.find('.color-preset-dropdown').slideUp(150);
            this.$element.find('.color-preset-dropdown-toggle .expand-arrow').removeClass('expanded');
            api.showSuccess(`Applied "${preset.name}"`);
        });

        // "+ New Theme" button — clears name input and deselects current preset
        this.$element.on('click', '.color-preset-new', () => {
            this._colorPresetName = '';
            this._selectedColorPresetId = null;
            this.$element.find('.color-preset-name-input').val('').focus();
            this.$element.find('.color-preset-save-btn').prop('disabled', true);
            this._colorPresetDropdownOpen = false;
            this.$element.find('.color-preset-dropdown').slideUp(150);
            this.$element.find('.color-preset-dropdown-toggle .expand-arrow').removeClass('expanded');
        });

        // Color preset export (palette only)
        this.$element.on('click', '.color-preset-export-btn', (e) => {
            e.preventDefault();
            const ctSettings = store.get('ui.crafting_tree.global_settings') || {};
            const data = {
                v: 1,
                lineColors: ctSettings.line_colors || DEFAULT_PALETTE,
                customColors: ctSettings.custom_colors || null,
            };
            try {
                const json = JSON.stringify(data);
                const bytes = new TextEncoder().encode(json);
                const compressed = window.pako.gzip(bytes);
                const b64 = btoa(String.fromCharCode(...compressed));
                navigator.clipboard.writeText(b64).then(() => {
                    api.showSuccess('Palette copied to clipboard');
                }).catch(() => { prompt('Copy this palette string:', b64); });
            } catch { api.showError('Failed to export palette'); }
        });

        // Color preset import (palette only)
        this.$element.on('click', '.color-preset-import-btn', async (e) => {
            e.preventDefault();
            let b64;
            try { b64 = await navigator.clipboard.readText(); }
            catch { b64 = prompt('Paste a palette string:'); }
            if (!b64 || !b64.trim()) return;
            try {
                const binary = atob(b64.trim());
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const decompressed = window.pako.ungzip(bytes, { to: 'string' });
                const data = JSON.parse(decompressed);
                if (data.v !== 1) throw new Error('Unknown version');
                this._applyColorPreset(data);
                api.showSuccess('Palette applied');
            } catch { api.showError('Invalid palette string'); }
        });

        // Color preset delete (two-click confirm, red styling via CSS classes)
        this.$element.on('click', '.color-preset-delete', async (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('preset-id').toString();
            if (this._colorPresetPendingDelete === id) {
                try {
                    await api.deleteColorPreset(id);
                    if (this._selectedColorPresetId === id) {
                        this._selectedColorPresetId = null;
                        this._colorPresetName = '';
                        this.$element.find('.color-preset-name-input').val('');
                        this.$element.find('.color-preset-save-btn').prop('disabled', true);
                    }
                    this._colorPresetPendingDelete = null;
                    $(e.currentTarget).closest('.color-preset-item').remove();
                    await this._loadColorPresets();
                } catch { api.showError('Failed to delete palette'); }
            } else {
                if (this._colorPresetPendingDelete) {
                    this.$element.find(`.color-preset-delete[data-preset-id="${this._colorPresetPendingDelete}"]`)
                        .removeClass('delete-confirm').addClass('delete-button').text('×');
                }
                this._colorPresetPendingDelete = id;
                $(e.currentTarget).removeClass('delete-button').addClass('delete-confirm').text('Delete?');
                setTimeout(() => {
                    if (this._colorPresetPendingDelete === id) {
                        this._colorPresetPendingDelete = null;
                        $(e.currentTarget).removeClass('delete-confirm').addClass('delete-button').text('×');
                    }
                }, 3000);
            }
        });

        // Drag and drop for sorting lists
        this.attachDragAndDrop('.activity-sort-list');
        this.attachDragAndDrop('.recipe-sort-list');

        // Collapsible section headers
        this.$element.on('click', '.settings-collapsible-header', (e) => {
            e.preventDefault();
            const sectionKey = $(e.currentTarget).data('section');
            const isCollapsed = !this.collapsedSections[sectionKey];
            this.collapsedSections[sectionKey] = isCollapsed;
            localStorage.setItem(`settingsCollapsed_${sectionKey}`, isCollapsed.toString());

            const $header = $(e.currentTarget);
            const $body = this.$element.find(`.settings-collapsible-body[data-section="${sectionKey}"]`);
            const $arrow = $header.find('.expand-arrow');

            if (isCollapsed) {
                $header.addClass('collapsed');
                $arrow.removeClass('expanded');
                $body.slideUp(200);
            } else {
                $header.removeClass('collapsed');
                $arrow.addClass('expanded');
                $body.slideDown(200);
            }
        });

        // Dismiss tip buttons
        this.$element.on('click', '.settings-dismiss-tip-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tipKey = $(e.currentTarget).data('tip');
            this.dismissedTips[tipKey] = true;
            localStorage.setItem(`settingsDismissed_${tipKey}`, 'true');
            $(e.currentTarget).closest('.settings-dismissible-tip').slideUp(200, function () {
                $(this).remove();
            });
        });

        // Preset dropdown toggle
        this.$element.on('click', '.preset-dropdown-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const $bar = $(e.currentTarget).closest('.preset-bar');
            const $dropdown = $bar.find('.gear-set-dropdown');
            const $arrow = $(e.currentTarget).find('.expand-arrow');

            if ($dropdown.is(':animated')) return;

            const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
            const isOpen = this['_' + presetType + 'PresetDropdownOpen'];

            if (!isOpen) {
                // Opening — populate content and slide down
                const presets = this[presetType + 'Presets'] || [];
                const selectedId = this['selected' + _cap + 'PresetId'];

                const presetItems = presets.map(p => {
                    return `
                        <div class="gear-set-item preset-item-entry" data-id="${p.id}" data-preset-type="${presetType}">
                            <span class="gear-set-name">${p.name}</span>
                            <button class="delete-button preset-item-delete" data-id="${p.id}" data-preset-type="${presetType}">×</button>
                        </div>
                    `;
                }).join('');

                $dropdown.html(`
                    <div class="gear-set-list">
                        <div class="gear-set-item new-gear-set preset-new-item" data-preset-type="${presetType}">
                            <span class="gear-set-name">+ New Preset</span>
                        </div>
                        ${presetItems}
                    </div>
                `);
                $arrow.addClass('expanded');
                $dropdown.slideDown(200);
            } else {
                // Closing — slide up
                $arrow.removeClass('expanded');
                $dropdown.slideUp(200);
            }

            this['_' + presetType + 'PresetDropdownOpen'] = !isOpen;
        });

        // Preset name input
        this.$element.on('input', '.preset-name-input', (e) => {
            const presetType = $(e.target).data('preset-type');
            const name = $(e.target).val();
            this['_' + presetType + 'PresetName'] = name;
            // Update save button state without full re-render
            const $saveBtn = $(e.target).closest('.preset-bar').find('.preset-save-btn');
            const hasName = name.trim().length > 0;
            $saveBtn.prop('disabled', !hasName);
            $saveBtn.css({
                'background': hasName ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                'color': hasName ? 'white' : 'var(--text-muted)',
                'border-color': hasName ? 'var(--accent-color)' : 'var(--border-color)',
                'cursor': hasName ? 'pointer' : 'default'
            });
        });

        // Preset save button
        this.$element.on('click', '.preset-save-btn', (e) => {
            e.preventDefault();
            const presetType = $(e.currentTarget).data('preset-type');
            this.savePreset(presetType);
        });

        // Preset item click (load)
        this.$element.on('click', '.preset-item-entry', (e) => {
            if ($(e.target).hasClass('preset-item-delete') || $(e.target).hasClass('delete-button')) return;
            const presetType = $(e.currentTarget).data('preset-type');
            const presetId = $(e.currentTarget).data('id');
            // Close dropdown with animation
            const $bar = $(e.currentTarget).closest('.preset-bar');
            $bar.find('.gear-set-dropdown').slideUp(200);
            $bar.find('.expand-arrow').removeClass('expanded');
            this['_' + presetType + 'PresetDropdownOpen'] = false;
            this.loadPreset(presetType, presetId);
        });

        // New preset click
        this.$element.on('click', '.preset-new-item', (e) => {
            const presetType = $(e.currentTarget).data('preset-type');
            // Close dropdown with animation
            const $bar = $(e.currentTarget).closest('.preset-bar');
            $bar.find('.gear-set-dropdown').slideUp(200);
            $bar.find('.expand-arrow').removeClass('expanded');
            const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
            this['selected' + _cap + 'PresetId'] = null;
            this['_' + presetType + 'PresetName'] = '';
            this['_' + presetType + 'PresetDropdownOpen'] = false;
            this._rerenderOptimizationTab();
            this.attachEvents();
            this.$element.find(`.preset-name-input[data-preset-type="${presetType}"]`).focus();
        });

        // Preset item delete — immediate, no confirm
        this.$element.on('click', '.preset-item-delete', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const presetId = $(e.currentTarget).data('id');
            this.deletePreset(presetType, presetId);
        });

        // Preset export button
        this.$element.on('click', '.preset-export-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const encoded = this.encodePreset(presetType);

            // Show the import input field with the encoded string for easy copying
            const $input = this.$element.find(`.preset-import-input[data-preset-type="${presetType}"]`);
            $input.show().val(encoded).select();

            // Try to copy to clipboard
            try {
                document.execCommand('copy');
                const $btn = $(e.currentTarget);
                const original = $btn.text();
                $btn.text('Copied!');
                setTimeout(() => $btn.text(original), 1500);
            } catch (err) {
                // Input is shown and selected, user can copy manually
            }
        });

        // Preset import button — toggle input visibility
        this.$element.on('click', '.preset-import-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const presetType = $(e.currentTarget).data('preset-type');
            const $input = this.$element.find(`.preset-import-input[data-preset-type="${presetType}"]`);
            $input.toggle().val('').focus();
        });

        // Preset import input — apply on Enter
        this.$element.on('keydown', '.preset-import-input', (e) => {
            if (e.key === 'Enter') {
                const presetType = $(e.target).data('preset-type');
                const encoded = $(e.target).val();
                if (encoded.trim()) {
                    this.decodeAndApplyPreset(presetType, encoded);
                }
            } else if (e.key === 'Escape') {
                $(e.target).hide().val('');
            }
        });

        // Weight slider ↔ numeric input bidirectional sync.
        //
        // IMPORTANT: selectors are scoped to `.sort-item .weight-slider`
        // and `.sort-item .weight-input` so these legacy handlers only
        // match the activity-mode sort items. The recipe Detailed panel
        // mounts xy-recipe-priority-list.js, which uses
        // `.xy-priority-entry` as its row wrapper and handles weight
        // changes internally (surgical in-place updates + its own
        // `_skipSettingsRerender=true` save path). Previously these
        // handlers used bare `.weight-slider` / `.weight-input` selectors
        // that ALSO caught XY sliders — silently failing to update (no
        // `.sort-item` ancestor) but still firing a debounced
        // `saveOptimizationSettings()` WITHOUT the skip flag, which
        // caused `optimizationSettingsLoaded` to trigger
        // `_renderInlineSettings()` and reset the user's scroll 300ms
        // after every weight tick.
        this.$element.on('input', '.sort-item .weight-slider', (e) => {
            const $slider = $(e.target);
            const val = parseInt($slider.val(), 10);
            $slider.closest('.sort-item').find('.weight-input').val(val);
            this._updateSliderTrack($slider[0]);
            this._updateWeightFromDOM($slider.closest('.sort-item'));
        });

        this.$element.on('change', '.sort-item .weight-input', (e) => {
            const $input = $(e.target);
            let val = parseInt($input.val(), 10);
            if (isNaN(val)) val = 100;
            val = Math.max(0, Math.min(100, val));
            $input.val(val);
            const $slider = $input.closest('.sort-item').find('.weight-slider');
            $slider.val(val);
            this._updateSliderTrack($slider[0]);
            this._updateWeightFromDOM($input.closest('.sort-item'));
        });

        // Initialize slider track fills on render
        this.$element.find('.weight-slider').each((_, el) => {
            this._updateSliderTrack(el);
        });

        // Skip obtained collectibles checkbox (inside cat:collectibles sort items)
        this.$element.on('change', '.skip-obtained-collectibles', (e) => {
            this.skipObtainedCollectibles = e.target.checked;
            localStorage.setItem('skipObtainedCollectibles', e.target.checked.toString());
            this.saveOptimizationSettings();
        });

        // Re-index all sort-items in a list so data-index on the outer
        // .sort-item AND data-sort-index on nested target elements match
        // the current position. Call after any insert/remove that doesn't
        // trigger a full re-render. Without this, the duplicate/remove
        // fast-paths leave stale indices on subsequent items, causing
        // target-button clicks on a duplicated row to mutate the wrong
        // entry in the sorting array.
        const reindexSortList = ($list) => {
            $list.children('.sort-item').each((i, el) => {
                const $el = $(el);
                $el.attr('data-index', i);
                $el.data('index', i);
                $el.find('[data-sort-index]').each((_, inner) => {
                    const $inner = $(inner);
                    $inner.attr('data-sort-index', i);
                    // Also clear jQuery's cached .data() value
                    $inner.data('sort-index', i);
                });
            });
        };

        // Up / down arrow reorder — activity sort list uses these too now.
        // Mirrors xy-recipe-priority-list.js `animateReorderSwap`: FLIP swap
        // via Web Animations API so only the two affected rows visibly move.
        // No full re-render, no scroll reset, matches the recipe Detailed view.
        //
        // For recipe clicks inside the XY mount, the mount's internal click
        // handler deals with it — we bail to avoid double-firing.
        this.$element.on('click', '.xy-move-up, .xy-move-down', (e) => {
            const $btn = $(e.currentTarget);
            if ($btn.closest('.xy-recipe-mount').length) return;
            if ($btn.prop('disabled')) return;
            e.preventDefault();
            e.stopPropagation();

            const isUp = $btn.hasClass('xy-move-up');
            const index = parseInt($btn.data('index'), 10);
            const listClass = $btn.data('list-class');
            const isActivity = listClass === 'activity-sort-list';
            const sorting = isActivity ? this.activitySorting : this.recipeSorting;

            const targetIdx = isUp ? index - 1 : index + 1;
            if (targetIdx < 0 || targetIdx >= sorting.length) return;

            const $list = $btn.closest('.sort-list');
            const $rows = $list.children('.sort-item');
            const $moved = $rows.eq(index);
            const $neighbor = $rows.eq(targetIdx);

            // Fallback to full re-render if DOM doesn't match expected layout.
            if (!$moved.length || !$neighbor.length) {
                const [mv] = sorting.splice(index, 1);
                sorting.splice(targetIdx, 0, mv);
                this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
                this.saveOptimizationSettings();
                this._rerenderOptimizationTab();
                return;
            }

            // FLIP — capture before-rects, data+DOM swap, animate deltas.
            const beforeMoved = $moved[0].getBoundingClientRect();
            const beforeNeighbor = $neighbor[0].getBoundingClientRect();

            const [movedEntry] = sorting.splice(index, 1);
            sorting.splice(targetIdx, 0, movedEntry);

            if (isUp) $moved.insertBefore($neighbor);
            else $moved.insertAfter($neighbor);

            const afterMoved = $moved[0].getBoundingClientRect();
            const afterNeighbor = $neighbor[0].getBoundingClientRect();
            const dyMoved = beforeMoved.top - afterMoved.top;
            const dyNeighbor = beforeNeighbor.top - afterNeighbor.top;
            const duration = 280;
            const easing = 'ease';
            if (dyMoved !== 0) {
                $moved[0].animate([
                    { transform: `translateY(${dyMoved}px)` },
                    { transform: 'translateY(0)' }
                ], { duration, easing });
            }
            if (dyNeighbor !== 0) {
                $neighbor[0].animate([
                    { transform: `translateY(${dyNeighbor}px)` },
                    { transform: 'translateY(0)' }
                ], { duration, easing });
            }

            // Reindex data-index on .sort-item (+ nested target controls) and
            // refresh the up/down button data-index + boundary disabled states.
            reindexSortList($list);
            const $allRows = $list.children('.sort-item');
            const total = $allRows.length;
            $allRows.each(function (i) {
                const $row = $(this);
                $row.find('.xy-move-up').attr('data-index', i).data('index', i).prop('disabled', i <= 0);
                $row.find('.xy-move-down').attr('data-index', i).data('index', i).prop('disabled', i >= total - 1);
            });

            // Suppress the inline panel's optimizationSettingsLoaded re-render
            // while the save is in flight (save dispatches the event).
            const ob = window.optimizeButton;
            if (ob) ob._skipSettingsRerender = true;
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            const done = this.saveOptimizationSettings();
            const clearFlag = () => { if (ob) ob._skipSettingsRerender = false; };
            if (done && typeof done.finally === 'function') done.finally(clearFlag);
            else setTimeout(clearFlag, 400);

            // Scroll follow — keep the moved row in view if it drifted past
            // the edge of the modal's scroll container.
            setTimeout(() => {
                try {
                    const el = $moved[0];
                    if (el && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                } catch (_err) { /* noop */ }
            }, 300);
        });

        // Remove button — slide up and remove (no re-render)
        this.$element.on('click', '.sort-remove-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            if ($btn.prop('disabled')) return;

            const $item = $btn.closest('.sort-item');
            const index = parseInt($item.data('index'), 10);
            const $list = $item.closest('.sort-list');
            const isActivity = $list.hasClass('activity-sort-list');

            $item.css('pointer-events', 'none');
            $item.slideUp(250, () => {
                $item.remove();
                if (isActivity) {
                    this.activitySorting.splice(index, 1);
                } else {
                    this.recipeSorting.splice(index, 1);
                }
                reindexSortList($list);
                this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
                this.saveOptimizationSettings();
            });
            return false;
        });

        // Duplicate button — clone, insert hidden, slide down (no re-render)
        this.$element.on('click', '.sort-duplicate-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const $item = $(e.currentTarget).closest('.sort-item');
            const key = $item.data('key');
            const index = parseInt($item.data('index'), 10);
            // Prefer live input value over data-weight (which can be stale).
            // Use isNaN check instead of `|| 100` so 0 is preserved.
            const $input = $item.find('.weight-input');
            let weight = parseInt($input.val(), 10);
            if (isNaN(weight)) {
                weight = parseInt($item.data('weight'), 10);
                if (isNaN(weight)) weight = 100;
            }
            const $list = $item.closest('.sort-list');
            const isActivity = $list.hasClass('activity-sort-list');

            const sorting = isActivity ? this.activitySorting : this.recipeSorting;
            const existingTarget = sorting[index] ? sorting[index][2] || null : null;
            sorting.splice(index + 1, 0, [key, weight, existingTarget]);

            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');

            const $clone = $item.clone();
            $clone.css('display', 'none');
            $item.after($clone);
            // Re-index the whole list so the clone AND all subsequent items
            // have correct data-index and nested data-sort-index values.
            // Without this, the clone's .sort-target-btn keeps the original's
            // data-sort-index and editing the copy mutates the original.
            reindexSortList($list);
            $clone.slideDown(250, () => {
                this.saveOptimizationSettings();
            });
            return false;
        });

        // Sort target button click — toggle floating target dropdown
        this.$element.on('click', '.sort-target-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const sortIndex = parseInt($btn.data('sort-index'), 10);
            const $embedded = $btn.closest('.sort-embedded-target');
            const targetType = $embedded.data('target-type'); // 'drop' or 'quality'
            const $arrow = $btn.find('.expand-arrow');

            // Close any existing floating dropdown
            const $existingFloat = $('body > .settings-floating-dropdown');
            if ($existingFloat.length) {
                $existingFloat.remove();
                this.$element.find('.sort-target-btn .expand-arrow.expanded').removeClass('expanded');
                // If clicking the same button, just close
                if ($existingFloat.data('sort-index') === sortIndex) return;
            }

            // Build dropdown content based on type
            let dropdownHtml = '';
            if (targetType === 'drop') {
                // Always render drop (category) content for drop-type sort items,
                // regardless of what's currently selected in column 3.
                const optimizeBtn = window.optimizeButton;
                if (optimizeBtn && optimizeBtn._renderActivityTargetDropdown) {
                    dropdownHtml = optimizeBtn._renderActivityTargetDropdown();
                }
            } else if (targetType === 'quality') {
                const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
                const qualityColors = { 'Normal': 'var(--rarity-common)', 'Good': 'var(--rarity-uncommon)', 'Great': 'var(--rarity-rare)', 'Excellent': 'var(--rarity-epic)', 'Perfect': 'var(--rarity-legendary)', 'Eternal': 'var(--rarity-ethereal)' };
                const qualityBorders = { 'Normal': 'var(--rarity-common-border)', 'Good': 'var(--rarity-uncommon-border)', 'Great': 'var(--rarity-rare-border)', 'Excellent': 'var(--rarity-epic-border)', 'Perfect': 'var(--rarity-legendary-border)', 'Eternal': 'var(--rarity-ethereal-border)' };
                dropdownHtml = qualities.map(q => {
                    const bg = qualityColors[q] || '';
                    const border = qualityBorders[q] || '';
                    const style = (bg && border) ? `background:${bg};border:1px solid ${border};` : '';
                    return `<div class="target-item" data-value="${q}" style="${style}padding:8px 12px;text-align:center;cursor:pointer;font-weight:600;">${q}</div>`;
                }).join('');
            }

            if (!dropdownHtml) return;

            // Create floating dropdown appended to body
            const btnRect = $btn[0].getBoundingClientRect();
            const $float = $(`<div class="settings-floating-dropdown target-dropdown" data-sort-index="${sortIndex}" style="position:fixed;top:${btnRect.bottom + 4}px;left:${btnRect.left}px;width:${btnRect.width}px;z-index:10000;max-height:300px;overflow-y:auto;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:none;">${dropdownHtml}</div>`);
            $('body').append($float);
            if (typeof wireInfoIcons === 'function') {
                wireInfoIcons($float[0]);
            } else if (window.wireInfoIcons) {
                window.wireInfoIcons($float[0]);
            }
            $arrow.addClass('expanded');
            $float.slideDown(200);

            // Click on item in floating dropdown
            $float.on('click', '.target-item', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const value = $(ev.currentTarget).data('value');
                // Determine which list this button belongs to from the button itself,
                // not from the overall modal (both lists render simultaneously).
                const isActivity = $btn.closest('.sort-list').hasClass('activity-sort-list');
                const sorting = isActivity ? this.activitySorting : this.recipeSorting;

                if (sortIndex >= 0 && sortIndex < sorting.length) {
                    sorting[sortIndex][2] = value;
                }

                $arrow.removeClass('expanded');
                $float.slideUp(200, () => {
                    $float.remove();
                    this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
                    this._rerenderOptimizationTab();
                    this.saveOptimizationSettings();
                });
            });

            // Click outside to close
            setTimeout(() => {
                $(document).one('click.settings-target-dropdown', (ev) => {
                    if (!$(ev.target).closest('.settings-floating-dropdown, .sort-target-btn').length) {
                        $arrow.removeClass('expanded');
                        $float.slideUp(200, () => $float.remove());
                    }
                });
            }, 100);
        });

        // Add button → show dropdown
        this.$element.on('click', '.sort-add-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $wrapper = $(e.currentTarget).closest('.sort-add-wrapper');
            const $dropdown = $wrapper.find('.sort-add-dropdown');
            $dropdown.val('');
            $dropdown.toggle();
            return false;
        });

        // Add dropdown selection
        this.$element.on('change', '.sort-add-dropdown', (e) => {
            const $dropdown = $(e.target);
            const key = $dropdown.val();
            if (!key) return;

            const $wrapper = $dropdown.closest('.sort-add-wrapper');
            const $list = $wrapper.next('.sort-list');
            const isActivity = $list.hasClass('activity-sort-list');

            if (isActivity) {
                this.activitySorting.push([key, 100, null]);
            } else {
                this.recipeSorting.push([key, 100, null]);
            }

            $dropdown.hide();
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();
            this._rerenderOptimizationTab();
        });

        // Reset to default button
        this.$element.on('click', '.sort-reset-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const listClass = $(e.currentTarget).data('list');
            const isActivity = listClass === 'activity-sort-list';

            if (isActivity) {
                // Activity sorting now uses the X-per-Y dict shape (mirror
                // of recipe). Fresh defaults come from the shared helper
                // so the client and backend DEFAULT_ACTIVITY_ORDER stay
                // in sync. Propagate to all mounted controllers so any
                // visible panel updates immediately.
                this.activitySorting = defaultActivityEntries();
                this._propagateActivitySortingToMounts();
            } else {
                // Recipe sorting uses the X-per-Y dict shape. Fresh defaults
                // come from the shared helper so the client and backend
                // DEFAULT_RECIPE_ORDER stay in sync.
                this.recipeSorting = defaultRecipeEntries();
                this._propagateRecipeSortingToMounts();
            }

            this.saveOptimizationSettings();
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this._rerenderOptimizationTab();
        });

        // Include consumables checkbox (global)
        this.$element.on('change', '.include-consumables-checkbox', (e) => {
            this.includeConsumables = e.target.checked;
            this.saveGlobalOptimizationSettings();
        });

        // Show item finding drops checkbox
        this.$element.on('change', '.show-item-finding-drops-checkbox', (e) => {
            this.saveShowItemFindingDrops(e.target.checked);
        });

        // Auto-equip optimized gear set checkbox
        this.$element.on('change', '.auto-equip-optimized-checkbox', (e) => {
            this.autoEquipOptimized = e.target.checked;
            this.saveGlobalOptimizationSettings();
        });

        // Auto copy export string after optimization checkbox
        this.$element.on('change', '.auto-copy-export-checkbox', (e) => {
            this.autoCopyExport = e.target.checked;
            this.saveGlobalOptimizationSettings();
        });

        // Lock current gear set slots checkbox
        this.$element.on('change', '.lock-current-gear-slots-checkbox', (e) => {
            this.lockCurrentGearSlots = e.target.checked;
            this.saveGlobalOptimizationSettings();
            // Dispatch event so travel page can react
            window.dispatchEvent(new CustomEvent('lockGearSlotsChanged', { detail: { value: e.target.checked } }));
        });

        this.$element.on('change', '.include-pets-checkbox', (e) => {
            this.includePets = e.target.checked;
            this.saveGlobalOptimizationSettings();
        });

        this.$element.on('change', '.run-local-optimization-checkbox', (e) => {
            this.runLocalOptimization = e.target.checked;
            this.saveGlobalOptimizationSettings();
            // Mirror to the goals-report "Run locally" checkbox (same setting,
            // two surfaces). The goals report listens for this event.
            try {
                window.dispatchEvent(new CustomEvent('runLocalOptimizationChanged',
                    { detail: { enabled: this.runLocalOptimization } }));
            } catch (_) { /* non-fatal */ }
        });

        this.$element.on('change', '.finish-on-server-checkbox', (e) => {
            this.finishOnServerOnLeave = e.target.checked;
            this.saveGlobalOptimizationSettings();
        });

        this.$element.on('change', '.disable-local-opt-warning-checkbox', (e) => {
            this.disableLocalOptWarning = e.target.checked;
            this.saveGlobalOptimizationSettings();
            // Let the speed-warning controller react immediately (e.g. cancel a
            // pending benchmark on this device) without waiting for a reload.
            try {
                window.dispatchEvent(new CustomEvent('localOptWarningDisabledChanged',
                    { detail: { disabled: this.disableLocalOptWarning } }));
            } catch (_) { /* non-fatal */ }
        });

        // Escape key to close
        $(document).on('keydown.settings-modal', (e) => {
            if (e.key === 'Escape' && this.visible) {
                this.hide();
            }
        });

        // Push: Enable button
        this.$element.on('click', '.push-enable-btn', async (e) => {
            e.preventDefault();
            // Show inline loading without full re-render
            const $btn = this.$element.find('.push-enable-btn');
            $btn.prop('disabled', true).text('Setting up notifications…');
            this._pushPermission = 'granted';
            await this._initPushNotifications();
        });

        // Push: Disable button
        this.$element.on('click', '.push-disable-btn', async (e) => {
            e.preventDefault();
            try {
                if (this._pushSubscription) {
                    await fetch('/api/push/subscribe', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: this._pushSubscription.endpoint }),
                    });
                    await this._pushSubscription.unsubscribe();
                    this._pushSubscription = null;
                }
            } catch (err) {
                console.error('Push unsubscribe failed:', err);
            }
            this.render();
            this.attachEvents();
        });

        // Push: preference checkboxes
        this.$element.on('change', '.push-pref-global', (e) => {
            this._pushPrefs.global_announcements = e.target.checked;
            this._savePushPreferences();
        });
        this.$element.on('change', '.push-pref-targeted', (e) => {
            this._pushPrefs.targeted_announcements = e.target.checked;
            this._savePushPreferences();
        });

        // Show nudge when personalization tab is opened
        if (this.activeTab === 'personalization') {
            setTimeout(() => this._showPushNudgeIfNeeded(), 300);
        }

        // Mount the X-per-Y recipe priority list (replaces the legacy
        // renderSortList for recipe). This has to happen after the main
        // render so the .xy-recipe-mount div exists in the DOM.
        this._mountXyRecipePriorityList();
        // Mount the X-per-Y activity priority list (mirror of recipe).
        this._mountXyActivityPriorityList();
        // Mount the travel priority list (Settings-modal Detailed).
        this._mountTravelSettingsList();
    }

    /**
     * Mount (or re-mount) the X-per-Y recipe priority list into the
     * Settings > Optimization > Recipe section.
     */
    _mountXyRecipePriorityList() {
        const $mount = this.$element.find('.xy-recipe-mount[data-mount-id="settings-modal-recipe"]');
        if (!$mount.length) return;

        // Destroy any prior mount so we don't leak delegated handlers.
        if (this._xyRecipeController) {
            try { this._xyRecipeController.destroy(); } catch (e) { /* noop */ }
            this._xyRecipeController = null;
        }

        this._xyRecipeController = mountXyPriorityList($mount, {
            entries: this.recipeSorting,
            mode: 'detailed',
            includeItemFinding: this.showItemFindingDrops,
            onChange: (entries) => {
                this.recipeSorting = entries;
                // Clear any active preset selection (user customized).
                this._clearPresetSelection('recipe');
                // Short debounce (50ms) — just enough to coalesce rapid
                // weight-slider fires, short enough that a close-and-reopen
                // of the modal can't race the save. Previously this was
                // 300ms and users reported losing edits on close.
                clearTimeout(this._xyRecipeSaveTimer);
                this._xyRecipeSaveTimer = setTimeout(() => {
                    const ob = window.optimizeButton;
                    if (ob) ob._skipSettingsRerender = true;
                    const done = this.saveOptimizationSettings();
                    const clearFlag = () => { if (ob) ob._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Mount (or re-mount) the X-per-Y activity priority list into the
     * Settings > Optimization > Activity section. Mirror of
     * _mountXyRecipePriorityList. activitySorting carries dict entries
     * after migration; legacy tuples are normalized by the backend GET.
     */
    _mountXyActivityPriorityList() {
        const $mount = this.$element.find('.xy-activity-mount[data-mount-id="settings-modal-activity"]');
        if (!$mount.length) return;

        if (this._xyActivityController) {
            try { this._xyActivityController.destroy(); } catch (e) { /* noop */ }
            this._xyActivityController = null;
        }

        this._xyActivityController = mountXyActivityPriorityList($mount, {
            entries: this.activitySorting,
            mode: 'detailed',
            includeItemFinding: this.showItemFindingDrops,
            // The settings modal doesn't have a specific activity context
            // (user may not have one selected on Column 3), so the drop
            // table is null. The component falls back to "assume valid"
            // for all categories — N/A markers only appear when the user
            // edits priorities from the Column-3 inline panel where the
            // selected activity's drop table is available.
            activityDropTable: null,
            onChange: (entries) => {
                this.activitySorting = entries;
                this._clearPresetSelection('activity');
                clearTimeout(this._xyActivitySaveTimer);
                this._xyActivitySaveTimer = setTimeout(() => {
                    const ob = window.optimizeButton;
                    if (ob) ob._skipSettingsRerender = true;
                    const done = this.saveOptimizationSettings();
                    const clearFlag = () => { if (ob) ob._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Mount (or re-mount) the travel priority list into the Settings >
     * Optimization > Travel section (Detailed mode). Mirror of the activity/
     * recipe mounts, but uses the dedicated 2-metric travel component.
     */
    _mountTravelSettingsList() {
        const $mount = this.$element.find('.travel-settings-mount[data-mount-id="settings-modal-travel"]');
        if (!$mount.length) return;

        if (this._travelSettingsController) {
            try { this._travelSettingsController.destroy(); } catch (e) { /* noop */ }
            this._travelSettingsController = null;
        }

        this._travelSettingsController = mountTravelPriorityList($mount, {
            entries: this.travelSorting && this.travelSorting.length ? this.travelSorting : defaultTravelEntries(),
            mode: 'detailed',
            onChange: (entries) => {
                this.travelSorting = entries;
                this._clearPresetSelection('travel');
                clearTimeout(this._travelSettingsSaveTimer);
                this._travelSettingsSaveTimer = setTimeout(() => {
                    const ob = window.optimizeButton;
                    if (ob) ob._skipSettingsRerender = true;
                    const done = this.saveOptimizationSettings();
                    const clearFlag = () => { if (ob) ob._skipSettingsRerender = false; };
                    if (done && typeof done.finally === 'function') done.finally(clearFlag);
                    else queueMicrotask(clearFlag);
                }, 50);
            },
        });
    }

    /**
     * Handle export config button click — fetches character data from backend
     * and copies it to clipboard in the same JSON format as the game export.
     */
    async handleExportConfig() {
        const uuid = store.state.session?.uuid;
        if (!uuid) {
            api.showError('No active session');
            return;
        }

        const $btn = this.$element.find('.export-config-btn');
        const originalText = $btn.text();
        $btn.text('Exporting...').prop('disabled', true);

        try {
            const result = await api.exportCharacterConfig(uuid);
            if (result && result.success && result.export) {
                const json = JSON.stringify(result.export, null, 2);
                await navigator.clipboard.writeText(json);
                api.showSuccess('Character config copied to clipboard');
                $btn.text('Copied!');
                setTimeout(() => $btn.text(originalText).prop('disabled', false), 1500);
            } else {
                api.showError('Export returned no data');
                $btn.text(originalText).prop('disabled', false);
            }
        } catch (err) {
            $btn.text(originalText).prop('disabled', false);
        }
    }

    /**
     * Handle switch session button click
     */
    handleSwitchSession() {
        if (this.isSubmitting) {
            return;
        }

        // Get UUID from input
        const newUuid = this.$element.find('.uuid-input').val().trim();

        // Validate not empty
        if (!newUuid) {
            this.showError('Please enter a session UUID.');
            return;
        }

        // Validate UUID format (basic check)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(newUuid)) {
            this.showError('Invalid UUID format. Please enter a valid UUID.');
            return;
        }

        // Check if it's the same as current
        if (newUuid === store.state.session.uuid) {
            this.showError('This is already your current session.');
            return;
        }

        // Submit switch request
        this.switchSession(newUuid);
    }

    /**
     * Switch to a different session
     * @param {string} newUuid - UUID of session to switch to
     */
    switchSession(newUuid) {
        // Set submitting state
        this.isSubmitting = true;
        this.errorMessage = '';
        this.render();
        this.attachEvents();

        // Load new session
        api.getSession(newUuid)
            .done((data) => {
                // Update store with new session
                store.state.session.uuid = newUuid;
                store.state.character = data.character_config || {};
                store.state.ui = data.ui_config || {};

                // Update cookie
                document.cookie = `session_uuid=${newUuid}; path=/; max-age=31536000`;

                // Show success message
                api.showSuccess('Session switched successfully!');

                // Notify all subscribers
                store._notifySubscribers('session');

                // Close modal and reload page
                this.hide();

                // Reload page after a short delay to show success message
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            })
            .fail((xhr, status, error) => {
                // Error - extract message
                let errorMsg = 'Failed to switch session.';

                if (xhr.responseJSON) {
                    if (xhr.responseJSON.message) {
                        errorMsg = xhr.responseJSON.message;
                    } else if (xhr.responseJSON.detail) {
                        errorMsg = xhr.responseJSON.detail;
                    } else if (xhr.responseJSON.error) {
                        errorMsg = xhr.responseJSON.error;
                    }
                }

                // Show error in modal
                this.showError(errorMsg);
            })
            .always(() => {
                // Reset submitting state
                this.isSubmitting = false;
                this.render();
                this.attachEvents();
            });
    }

    /**
     * Show error message in modal
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.errorMessage = message;
        this.render();
        this.attachEvents();
    }

    /**
     * Show the modal
     */
    async show(tab = null) {
        if (tab) {
            this.activeTab = tab;
        }
        this.visible = true;
        this.errorMessage = '';

        // If a save was fired from the previous hide() and is still in
        // flight, wait for it to complete before we re-fetch settings
        // from the server. Otherwise the GET below can race the POST and
        // load the pre-edit state.
        if (this._pendingSavePromise) {
            try { await this._pendingSavePromise; } catch (e) { /* noop */ }
            this._pendingSavePromise = null;
        }

        // Reload optimization settings when opening modal
        await this.loadOptimizationSettings();

        // Check for existing push subscription on open. If permission is granted
        // but there's no local subscription (e.g. VAPID key rotated, PWA reinstalled,
        // browser cleared storage), auto re-subscribe so the UI doesn't sit on
        // "Loading preferences…" forever and push delivery actually works.
        if (this.pushSupported() && this._pushPermission === 'granted' && !this._pushSubscription) {
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                    this._pushSubscription = sub;
                    const prefResp = await fetch('/api/push/preferences');
                    this._pushPrefs = await prefResp.json();
                } else {
                    // No subscription on this device — kick off re-subscribe flow.
                    // _initPushNotifications() handles VAPID fetch, subscribe,
                    // server POST, preference seeding, and its own render() at end.
                    // Fire-and-forget: don't block show() on network round-trips,
                    // but the render() it performs will update the modal in place.
                    this._initPushNotifications().catch((e) => {
                        console.error('Push auto re-subscribe failed:', e);
                    });
                }
            } catch (e) {
                console.error('Push subscription check failed:', e);
            }
        }

        this.render();
        this.attachEvents();

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.css('display', 'flex');
        // Small delay to ensure display change is processed
        setTimeout(() => {
            $overlay.addClass('show');
        }, 10);
    }

    /**
     * Hide the modal
     */
    hide() {
        if (this.isSubmitting) {
            return;
        }

        this.visible = false;

        // Flush any pending recipe-sorting save BEFORE the modal closes so
        // changes made just before hitting "close" actually reach the
        // server. We AWAIT the save here (as a fire-and-started promise)
        // so the next show() — which calls loadOptimizationSettings() to
        // re-fetch from the server — doesn't race the in-flight save and
        // end up displaying the pre-edit state (bug report #2:
        // "closing it and coming back make it show the default again").
        //
        // We don't actually `await` at the function level (hide is called
        // from sync click handlers), but we attach the save promise to
        // this._pendingSavePromise so show() can wait on it.
        const flushed = [];
        if (this._xyRecipeSaveTimer) {
            clearTimeout(this._xyRecipeSaveTimer);
            this._xyRecipeSaveTimer = null;
            try { flushed.push(this.saveOptimizationSettings()); } catch (e) { /* noop */ }
        }
        if (this._weightSaveTimer) {
            clearTimeout(this._weightSaveTimer);
            this._weightSaveTimer = null;
            try { flushed.push(this.saveOptimizationSettings()); } catch (e) { /* noop */ }
        }
        if (flushed.length) {
            this._pendingSavePromise = Promise.allSettled(flushed);
        }

        // Remove escape key handler
        $(document).off('keydown.settings-modal');

        // Use CSS class for animation (consistent with item selection popup)
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.removeClass('show');

        // Wait for animation to complete, then hide
        setTimeout(() => {
            $overlay.css('display', 'none');
            // Clear input after hiding
            this.$element.find('.uuid-input').val('');
            this.errorMessage = '';
        }, 200);
    }

    /**
     * Attach drag and drop handlers to a sorting list
     * @param {string} selector - CSS selector for the list
     */
    attachDragAndDrop(selector) {
        const $list = this.$element.find(selector);
        let draggedElement = null;
        let draggedIndex = null;
        let touchStartY = 0;
        let touchCurrentY = 0;
        let placeholder = null;

        // Make items draggable (for desktop)
        $list.find('.sort-item').each(function () {
            $(this).attr('draggable', 'true');
        });

        // Prevent drag when interacting with slider, input, remove button, or duplicate button
        $list.on('mousedown', '.weight-slider, .weight-input, .sort-remove-btn, .sort-duplicate-btn', (e) => {
            // Temporarily disable draggable on the parent sort-item
            const $item = $(e.target).closest('.sort-item');
            $item.attr('draggable', 'false');
            $(document).one('mouseup', () => {
                $item.attr('draggable', 'true');
            });
        });

        // ===== DESKTOP DRAG AND DROP =====

        // Drag start
        $list.on('dragstart', '.sort-item', (e) => {
            // Don't start drag if it originated from slider/input/button
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'button') {
                e.preventDefault();
                return;
            }
            draggedElement = e.currentTarget;
            draggedIndex = parseInt($(draggedElement).data('index'));
            $(draggedElement).addClass('dragging');
            e.originalEvent.dataTransfer.effectAllowed = 'move';
        });

        // Drag end
        $list.on('dragend', '.sort-item', (e) => {
            $(draggedElement).removeClass('dragging');
            draggedElement = null;
            draggedIndex = null;
        });

        // Drag over
        $list.on('dragover', '.sort-item', (e) => {
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'move';

            const $target = $(e.currentTarget);
            if ($target[0] === draggedElement) return;

            // Get bounding rect
            const rect = $target[0].getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;

            // Determine if we should insert before or after
            if (e.originalEvent.clientY < midpoint) {
                $target.before($(draggedElement));
            } else {
                $target.after($(draggedElement));
            }
        });

        // Drop
        $list.on('drop', '.sort-item', (e) => {
            e.preventDefault();

            // Update the order in our data, preserving weights.
            // Read weight from the actual input (not data-weight attribute, which
            // isn't updated when the user drags the slider).
            const isActivity = $list.hasClass('activity-sort-list');
            const sorting = isActivity ? this.activitySorting : this.recipeSorting;
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                const $input = $(this).find('.weight-input');
                let weight = parseInt($input.val(), 10);
                if (isNaN(weight)) {
                    weight = parseInt($(this).data('weight'), 10);
                    if (isNaN(weight)) weight = 100;
                }
                weight = Math.max(0, Math.min(100, weight));
                const target = $(this).data('target') || null;
                $(this).data('index', index);
                $(this).attr('data-index', index);
                $(this).attr('data-weight', weight); // keep DOM attr in sync for next reorder
                // Keep nested target-button indices in sync so clicks on
                // .sort-target-btn update the right entry in the sorting array.
                $(this).find('[data-sort-index]').each(function () {
                    $(this).attr('data-sort-index', index);
                    $(this).data('sort-index', index);
                });
                newOrder.push([key, weight, target]);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();
        });

        // ===== MOBILE TOUCH EVENTS =====

        // Touch start — on mobile, only allow drag from the handle (☰)
        $list.on('touchstart', '.drag-handle', (e) => {
            const $item = $(e.currentTarget).closest('.sort-item');
            draggedElement = $item[0];
            draggedIndex = parseInt($item.data('index'));
            touchStartY = e.originalEvent.touches[0].clientY;
            touchCurrentY = touchStartY;

            // Add dragging class after a short delay to distinguish from scrolling
            setTimeout(() => {
                if (draggedElement) {
                    $(draggedElement).addClass('dragging');
                }
            }, 100);
        });

        // Touch move — listen on the list so it works even when finger moves off the handle
        $list.on('touchmove', (e) => {
            if (!draggedElement) return;

            e.preventDefault(); // Prevent scrolling while dragging
            touchCurrentY = e.originalEvent.touches[0].clientY;

            // Find which element we're over
            const elements = $list.find('.sort-item').not('.dragging');
            let targetElement = null;

            elements.each(function () {
                const rect = this.getBoundingClientRect();
                if (touchCurrentY >= rect.top && touchCurrentY <= rect.bottom) {
                    targetElement = this;
                    return false; // Break loop
                }
            });

            if (targetElement && targetElement !== draggedElement) {
                const rect = targetElement.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                if (touchCurrentY < midpoint) {
                    $(targetElement).before($(draggedElement));
                } else {
                    $(targetElement).after($(draggedElement));
                }
            }

            // Auto-scroll near edges so the user can drop an item far from
            // its starting position without having to pause and scroll.
            const scrollParent = findScrollParent(draggedElement);
            updateAutoScroll(touchCurrentY, scrollParent);
        });

        // Touch end — listen on list level to catch end even if finger drifted
        $list.on('touchend touchcancel', (e) => {
            if (!draggedElement) return;
            stopAutoScroll();

            $(draggedElement).removeClass('dragging');

            // Update the order in our data, preserving weights.
            // Read weight from the actual input (not data-weight attribute).
            const isActivity = $list.hasClass('activity-sort-list');
            const newOrder = [];

            $list.find('.sort-item').each(function (index) {
                const key = $(this).data('key');
                const $input = $(this).find('.weight-input');
                let weight = parseInt($input.val(), 10);
                if (isNaN(weight)) {
                    weight = parseInt($(this).data('weight'), 10);
                    if (isNaN(weight)) weight = 100;
                }
                weight = Math.max(0, Math.min(100, weight));
                const target = $(this).data('target') || null;
                $(this).data('index', index);
                $(this).attr('data-weight', weight);
                newOrder.push([key, weight, target]);
            });

            if (isActivity) {
                this.activitySorting = newOrder;
            } else {
                this.recipeSorting = newOrder;
            }

            // Auto-save immediately after drop
            this._clearPresetSelection(isActivity ? 'activity' : 'recipe');
            this.saveOptimizationSettings();

            // Reset state
            draggedElement = null;
            draggedIndex = null;
            touchStartY = 0;
            touchCurrentY = 0;
        });
    }

    /**
     * Save consumables settings to backend
     */
    async saveConsumablesSettings() {
        // Update store state so optimize button can read it
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.includeConsumables = this.includeConsumables;
        await this.saveOptimizationSettings();
    }

    /**
     * Save global optimization settings (auto-equip, lock slots) to backend
     */
    async saveGlobalOptimizationSettings() {
        await this.saveOptimizationSettings();
    }

    /**
     * Save all optimization settings to backend (always sends full payload)
     */
    async saveOptimizationSettings() {
        try {
            // `this.recipeSorting` is the single source of truth for recipe
            // entries — every XY controller (settings-modal Detailed,
            // Column 3 inline Detailed, Column 3 Quick) writes its latest
            // edit into it synchronously via its `onChange` handler before
            // scheduling the debounced save.
            //
            // Previously this preferred `_xyRecipeController.getEntries()`
            // whenever the settings-modal controller had ever been mounted.
            // That controller's internal `state.entries` only updates when
            // the settings modal *itself* is the editor — the Quick and
            // Inline controllers intentionally don't call setEntries on
            // siblings (scroll-jitter on weight sliders, see optimize-
            // button.js). So once a user had opened the settings modal
            // once in a session, every subsequent Quick-panel edit (hide,
            // duplicate, add priority #1, …) got silently overwritten at
            // save time by the stale settings-modal snapshot.
            const recipeEntries = this.recipeSorting;

            const response = await $.ajax({
                url: '/api/optimization-settings',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    activity_sorting: this.activitySorting,
                    recipe_sorting: recipeEntries,
                    travel_sorting: this.travelSorting,
                    include_consumables: this.includeConsumables,
                    auto_equip_optimized: this.autoEquipOptimized,
                    auto_copy_export: this.autoCopyExport,
                    lock_current_gear_slots: this.lockCurrentGearSlots,
                    include_pets: this.includePets,
                    run_local_optimization: this.runLocalOptimization,
                    finish_on_server_on_leave: this.finishOnServerOnLeave,
                    disable_local_opt_warning: this.disableLocalOptWarning,
                    show_non_owned_alternatives: this.showNonOwnedAlternatives,
                    skip_obtained_collectibles: this.skipObtainedCollectibles
                })
            });
            console.log('✓ Optimization settings saved', response);
            // Notify other components that settings changed
            window.dispatchEvent(new CustomEvent('optimizationSettingsLoaded'));
        } catch (error) {
            console.error('Failed to save optimization settings:', error);
            api.showError('Failed to save optimization settings');
        }
    }

    // ========================================================================
    // OPTIMIZATION PRESETS
    // ========================================================================

    async loadOptimizationPresets() {
        try {
            const [activityPresets, recipePresets, travelPresets] = await Promise.all([
                $.get('/api/optimization-presets/activity'),
                $.get('/api/optimization-presets/recipe'),
                $.get('/api/optimization-presets/travel')
            ]);
            this.activityPresets = activityPresets || [];
            this.recipePresets = recipePresets || [];
            this.travelPresets = travelPresets || [];
            console.log('Loaded presets:', { activity: this.activityPresets.length, recipe: this.recipePresets.length, travel: this.travelPresets.length });
            if (this.activeTab === 'optimization' && this.visible) {
                this._rerenderOptimizationTab();
            }
        } catch (error) {
            console.error('Failed to load optimization presets:', error);
        }
    }

    async savePreset(presetType) {
        const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
        const name = (this['_' + presetType + 'PresetName']) || '';
        if (!name.trim()) {
            api.showError('Enter a preset name first');
            return;
        }

        const sorting = this[presetType + 'Sorting'];
        const selectedId = this['selected' + _cap + 'PresetId'];

        try {
            const preset = await $.ajax({
                url: `/api/optimization-presets/${presetType}`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    name: name.trim(),
                    sorting: sorting,
                    // include_consumables is a GLOBAL toggle owned by the
                    // settings modal — it must NEVER be persisted in a
                    // saved rule set. Backend defaults missing field to
                    // False; existing DB rows are ignored on load (see
                    // loadPreset) so old presets stop clobbering the
                    // global value.
                    id: selectedId  // Update existing if selected
                })
            });
            console.log('Preset saved:', preset);
            await this.loadOptimizationPresets();
            this['selected' + _cap + 'PresetId'] = preset.id;
            this['_' + presetType + 'PresetName'] = preset.name;
            this._rerenderOptimizationTab();
            this.attachEvents();
        } catch (error) {
            const msg = error.responseJSON?.detail || 'Failed to save preset';
            api.showError(msg);
        }
    }

    async loadPreset(presetType, presetId) {
        const presets = this[presetType + 'Presets'] || [];
        const preset = presets.find(p => p.id === presetId);
        if (!preset) return;

        if (presetType === 'activity') {
            this.activitySorting = this._normalizeSortingTuples(preset.sorting);
            this.selectedActivityPresetId = presetId;
            this._activityPresetName = preset.name;
            this._propagateActivitySortingToMounts();
        } else if (presetType === 'travel') {
            // Travel presets are simple [key, weight, target] tuples — no
            // migration, just normalize + push into every travel mount.
            this.travelSorting = normalizeTravelEntries(preset.sorting);
            this.selectedTravelPresetId = presetId;
            this._travelPresetName = preset.name;
            this._propagateTravelSortingToMounts();
        } else {
            // Recipe presets may have been saved in either format: legacy
            // [key, weight, target] tuples (older) or new X-per-Y dicts
            // (current). Detect by shape and pass dicts through unchanged
            // so they survive the round-trip. Without this, _normalizeSortingTuples
            // mangles dicts into garbage ("[object Object]" as a key), and
            // the mount controller treats them as invalid.
            this.recipeSorting = this._normalizeRecipeSortingAny(preset.sorting);
            // include_consumables intentionally ignored (see activity branch).
            this.selectedRecipePresetId = presetId;
            this._recipePresetName = preset.name;
            // Push the new entries into every currently-mounted XY controller
            // so the view updates immediately. Otherwise users see "nothing
            // happened" until the next full re-render.
            this._propagateRecipeSortingToMounts();
        }

        // Save to current settings too
        await this.saveOptimizationSettings();
        this._rerenderOptimizationTab();
        this.attachEvents();
    }

    /**
     * Normalize a recipe sorting list to the new X-per-Y dict format.
     * Accepts mixed shapes — passes dict entries through unchanged and
     * converts known legacy tuple shapes (`[key, weight, target]` or
     * plain strings) into their dict equivalents. Invalid entries are
     * dropped silently. Legacy keys that don't map to a known X/Y combo
     * are also dropped.
     *
     * Mirrors the backend's migrate_recipe_sorting (per-entry only —
     * default-filling is intentionally skipped so imports don't balloon).
     */
    _normalizeRecipeSortingAny(sorting) {
        if (!Array.isArray(sorting)) return [];

        // Mapping from legacy metric_key → (mode, x, y, defaultTargetItem).
        // Keep in sync with ui/optimization_settings_migration.py:
        // LEGACY_RECIPE_KEY_MIGRATION.
        const LEGACY_KEY_MAP = {
            'materials_for_target': ['ratio', 'materials', 'quality', null],
            'total_crafts': ['ratio', 'total_crafts', 'quality', null],
            'steps_for_target': ['ratio', 'expected_steps', 'quality', null],
            'steps_for_budget': ['budget', '', '', null],
            'expected_steps_per_item': ['ratio', 'expected_steps', 'craft', null],
            'current_steps': ['ratio', 'expected_steps', 'craft', null],
            'materials_per_craft': ['ratio', 'materials', 'craft', null],
            'primary_xp_per_step': ['ratio', 'xp', 'step', null],
            'primary_xp_per_action': ['ratio', 'xp', 'action', null],
            'materials_per_chest': ['ratio', 'materials', 'target_item', 'cat:chests'],
            'xp_per_material': ['ratio', 'xp', 'materials', null],
        };
        const VALID_QUALITIES = new Set(['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']);

        const clampWeight = (w) => {
            const n = Number.parseInt(w, 10);
            if (!Number.isFinite(n)) return 100;
            return Math.max(0, Math.min(100, n));
        };

        const makeFromLegacy = (key, weight, target) => {
            const m = LEGACY_KEY_MAP[key];
            if (!m) return null;
            const [mode, x, y, ti_default] = m;
            const w = clampWeight(weight);
            if (mode === 'budget') {
                return { mode: 'budget', weight: w, budgetMats: '', budgetTarget: '', hiddenInQuick: false };
            }
            let quality = 'Perfect';
            let targetItem = ti_default;
            if (y === 'quality' && typeof target === 'string' && VALID_QUALITIES.has(target)) {
                quality = target;
            } else if (y === 'target_item' && typeof target === 'string' && target) {
                targetItem = target;
            }
            return {
                mode: 'ratio', x, y, weight: w, quality, targetItem,
                hiddenInQuick: false,
            };
        };

        const out = [];
        for (const entry of sorting) {
            if (entry && typeof entry === 'object' && !Array.isArray(entry) && (entry.mode === 'ratio' || entry.mode === 'budget')) {
                out.push(entry);
                continue;
            }
            if (typeof entry === 'string') {
                const migrated = makeFromLegacy(entry, 100, null);
                if (migrated) out.push(migrated);
                continue;
            }
            if (Array.isArray(entry) && entry.length >= 1 && typeof entry[0] === 'string') {
                const [key, weight, target] = entry;
                const migrated = makeFromLegacy(key, weight != null ? weight : 100, target != null ? target : null);
                if (migrated) out.push(migrated);
                continue;
            }
            // Unknown shape: drop.
        }
        return out;
    }

    /**
     * Push the current this.recipeSorting into every mounted XY controller
     * (Settings modal Detailed, Column 3 Quick, Column 3 inline Detailed).
     * Called whenever recipeSorting changes via a path that isn't the mount
     * itself — preset load, import, reset.
     */
    _propagateRecipeSortingToMounts() {
        try { this._xyRecipeController?.setEntries(this.recipeSorting); } catch (e) { /* noop */ }
        const ob = window.optimizeButton;
        if (ob) {
            try { ob._xyQuickController?.setEntries(this.recipeSorting); } catch (e) { /* noop */ }
            try { ob._xyInlineController?.setEntries(this.recipeSorting); } catch (e) { /* noop */ }
        }
    }

    /**
     * Activity-side mirror of _propagateRecipeSortingToMounts. Pushes
     * this.activitySorting into every mounted activity XY controller
     * (Settings modal Detailed, Column 3 Quick, Column 3 inline Detailed).
     * Called when activitySorting changes via reset / preset load / import.
     */
    _propagateActivitySortingToMounts() {
        try { this._xyActivityController?.setEntries(this.activitySorting); } catch (e) { /* noop */ }
        const ob = window.optimizeButton;
        if (ob) {
            try { ob._xyActivityQuickController?.setEntries(this.activitySorting); } catch (e) { /* noop */ }
            try { ob._xyActivityInlineController?.setEntries(this.activitySorting); } catch (e) { /* noop */ }
        }
    }

    /**
     * Travel mirror of _propagateActivitySortingToMounts. Pushes
     * this.travelSorting into the Settings-modal Detailed travel mount and
     * the Column-3 travel Quick / Detailed controllers.
     */
    _propagateTravelSortingToMounts() {
        try { this._travelSettingsController?.setEntries(this.travelSorting); } catch (e) { /* noop */ }
        const ob = window.optimizeButton;
        if (ob) {
            try { ob._travelQuickController?.setEntries(this.travelSorting); } catch (e) { /* noop */ }
            try { ob._travelDetailedController?.setEntries(this.travelSorting); } catch (e) { /* noop */ }
        }
    }

    async deletePreset(presetType, presetId) {
        try {
            await $.ajax({
                url: `/api/optimization-presets/${presetType}/${presetId}`,
                method: 'DELETE'
            });
            // Clear selection if deleted preset was selected
            const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
            if (this['selected' + _cap + 'PresetId'] === presetId) {
                this['selected' + _cap + 'PresetId'] = null;
                this['_' + presetType + 'PresetName'] = '';
            }
            // Remove from DOM immediately (no re-render needed)
            this.$element.find(`.preset-item-entry[data-id="${presetId}"]`).remove();
            await this.loadOptimizationPresets();
        } catch (error) {
            api.showError('Failed to delete preset');
        }
    }


    renderPresetBar(presetType) {
        const _cap = presetType.charAt(0).toUpperCase() + presetType.slice(1);
        const presets = this[presetType + 'Presets'] || [];
        const selectedId = this['selected' + _cap + 'PresetId'];
        const selectedPreset = presets.find(p => p.id === selectedId);
        const currentName = (this['_' + presetType + 'PresetName'] ?? (selectedPreset ? selectedPreset.name : ''));
        const dropdownOpen = this['_' + presetType + 'PresetDropdownOpen'];

        const hasName = currentName.trim().length > 0;
        const arrowIcon = `<span class="expand-arrow ${dropdownOpen ? 'expanded' : ''}">▼</span>`;

        return `
            <div class="gear-set-manager preset-bar" data-preset-type="${presetType}" style="margin-bottom: var(--spacing-md);">
                <div class="gear-set-header">
                    <button
                        class="save-button preset-save-btn"
                        data-preset-type="${presetType}"
                        ${hasName ? '' : 'disabled'}
                    >Save</button>
                    <div class="gear-set-dropdown-button">
                        <input
                            type="text"
                            class="gear-set-name-input preset-name-input"
                            data-preset-type="${presetType}"
                            placeholder="New Preset"
                            value="${currentName}"
                            maxlength="100"
                        />
                        <button class="dropdown-toggle preset-dropdown-toggle" data-preset-type="${presetType}">${arrowIcon}</button>
                    </div>
                </div>
                <div class="gear-set-dropdown preset-dropdown" data-preset-type="${presetType}" style="display:none;"></div>
                <div style="
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-xs);
                    margin-top: var(--spacing-xs);
                ">
                    <button class="preset-export-btn" data-preset-type="${presetType}" style="
                        padding: 5px 14px;
                        font-size: 0.85em;
                        background: var(--bg-secondary);
                        color: var(--text-secondary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        cursor: pointer;
                    ">Export</button>
                    <button class="preset-import-btn" data-preset-type="${presetType}" style="
                        padding: 5px 14px;
                        font-size: 0.85em;
                        background: var(--bg-secondary);
                        color: var(--text-secondary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        cursor: pointer;
                    ">Import</button>
                    <input type="text" class="preset-import-input" data-preset-type="${presetType}" placeholder="Paste preset string..." style="
                        display: none;
                        flex: 1;
                        padding: 5px 8px;
                        font-size: 0.85em;
                        background: var(--bg-primary);
                        color: var(--text-primary);
                        border: 1px solid var(--border-color);
                        border-radius: 3px;
                        font-family: monospace;
                    " />
                </div>
            </div>
        `;
    }

    /**
     * Encode current sorting settings to a shareable string (gzip + base64).
     *
     * Only the per-section rule set (sorting entries) is encoded. Global
     * settings (include_consumables, include_pets, auto_equip_optimized,
     * lock_current_gear_slots, show_non_owned_alternatives, …) are
     * intentionally NOT included — they're per-user preferences, not part
     * of the shareable rule set. Importing a string must never silently
     * change a recipient's global toggles.
     */
    encodePreset(presetType) {
        const sorting = this[presetType + 'Sorting'];
        const data = { sorting };
        const jsonStr = JSON.stringify(data);
        const compressed = window.pako.gzip(jsonStr);
        let binary = '';
        const bytes = new Uint8Array(compressed);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Decode a preset string and apply it.
     */
    decodeAndApplyPreset(presetType, encoded) {
        try {
            const binaryString = atob(encoded.trim());
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const decompressed = window.pako.ungzip(bytes, { to: 'string' });
            const data = JSON.parse(decompressed);

            if (!data.sorting || !Array.isArray(data.sorting)) {
                throw new Error('Invalid preset format');
            }

            // include_consumables in imported strings is intentionally
            // ignored — it's a global setting, not part of the rule set.
            // Older share strings may still carry it; we just drop it on
            // the floor so importing never silently changes the
            // recipient's global toggle.

            if (presetType === 'activity') {
                this.activitySorting = this._normalizeSortingTuples(data.sorting);
                this.selectedActivityPresetId = null;
                this._activityPresetName = '';
            } else if (presetType === 'travel') {
                this.travelSorting = normalizeTravelEntries(data.sorting);
                this.selectedTravelPresetId = null;
                this._travelPresetName = '';
                this._propagateTravelSortingToMounts();
            } else {
                // Recipe import: accept either new dict format or legacy
                // tuples. Dicts pass through; legacy is ignored and the
                // mount controller's defaults fill in.
                this.recipeSorting = this._normalizeRecipeSortingAny(data.sorting);
                this.selectedRecipePresetId = null;
                this._recipePresetName = '';
                // Push into every mounted XY controller so the view updates
                // immediately (otherwise the import looks like a no-op).
                this._propagateRecipeSortingToMounts();
            }

            this.saveOptimizationSettings();
            this._rerenderOptimizationTab();
            this.attachEvents();
            return true;
        } catch (e) {
            console.error('Failed to decode preset:', e);
            api.showError('Invalid preset string');
            return false;
        }
    }

    /**
     * Save palette settings to store and apply CSS variables live.
     */
    _savePaletteSettings() {
        const palette = this.$element.find('.ct-palette-row.ct-palette-selected').data('palette') || DEFAULT_PALETTE;
        const customColors = [];
        this.$element.find('.ct-custom-color').each(function () {
            customColors.push($(this).val());
        });
        const existing = store.get('ui.crafting_tree.global_settings') || {};
        const updated = {
            ...existing,
            line_colors: palette,
            custom_colors: customColors.length === 8 ? customColors : LINE_COLOR_PALETTES['Custom'],
        };
        store.update('ui.crafting_tree.global_settings', updated);
        // Apply live without re-render
        _applyCraftingTreeColors(updated);
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        // Remove escape key handler
        $(document).off('keydown.settings-modal');
        super.destroy();
    }
}

/**
 * Show a new-user notification popup after the help/import popup is dismissed.
 * Call this from the import flow after the help popup is closed.
 * Only shown once (tracked via localStorage).
 */
export function showNewUserPushPopup() {
    if (!('serviceWorker' in navigator && 'PushManager' in window)) return;
    if (localStorage.getItem('push_new_user_popup_seen')) return;
    localStorage.setItem('push_new_user_popup_seen', '1');

    const $popup = $(`
        <div id="push-new-user-popup" style="
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 10000;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px 20px;
            max-width: 320px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        ">
            <p style="margin:0 0 10px;color:var(--text-primary);font-size:0.95em;">
                🔔 Want to get notified about new announcements?
            </p>
            <p style="margin:0 0 12px;color:var(--text-muted);font-size:0.82em;">
                You can enable or disable notifications at any time in Settings → Personalization.
            </p>
            <div style="display:flex;gap:8px;">
                <button id="push-popup-yes" class="button button-primary" style="flex:1;font-size:0.85em;">Enable</button>
                <button id="push-popup-no" class="button" style="flex:1;font-size:0.85em;background:var(--bg-tertiary);">Not now</button>
            </div>
        </div>
    `);

    $('body').append($popup);

    $popup.find('#push-popup-no').on('click', () => $popup.remove());
    $popup.find('#push-popup-yes').on('click', () => {
        $popup.remove();
        // Open settings modal on personalization tab
        if (window.settingsModal) {
            window.settingsModal.activeTab = 'personalization';
            window.settingsModal.show();
        }
    });

    // Auto-dismiss after 15 seconds
    setTimeout(() => $popup.fadeOut(400, () => $popup.remove()), 15000);
}

export default SettingsModal;
