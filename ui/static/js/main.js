/**
 * Main Entry Point - Walkscape UI
 * 
 * Initializes the application:
 * - Loads or creates session from cookie
 * - Fetches initial data from API
 * - Renders all components
 * - Shows import modal if needed
 * 
 * Requirements: 1.1, 1.2, 2.1, 2.5
 */

console.log('🚀 main.js loaded - Import Modal Fix Active');

// 2026-05-29 (jwbail): one-time URL redirect — the page hash was
// renamed from #stats-report to #goals-report. Anyone with an old
// bookmark or shared link lands on the empty page otherwise.
// replaceState avoids polluting browser history.
if (typeof window !== 'undefined' && window.location.hash === '#stats-report') {
    try {
        history.replaceState(null, '', window.location.pathname + window.location.search + '#goals-report');
    } catch (_) { /* fallback below */ }
    if (window.location.hash !== '#goals-report') {
        // browsers that block replaceState — set hash directly (will trigger hashchange)
        window.location.hash = '#goals-report';
    }
}

// Number formatting prefs MUST load first — its side-effects patch
// Number.prototype.toLocaleString so every component that follows picks up
// the user's chosen thousand + decimal separators on first paint.
import './utils/number-format.js';

import store from './state.js';
import api from './api.js';
import { maybeResumeLocalGoalsReport } from './local-compute.js';
import { initLocalSpeedBenchmark } from './local-speed-warning.js';
import './components/continue-local-run-popup.js'; // listens for goalsReportResumePrompt
import './crafting-tree-diff.js'; // dev tool: window.__ctOptimizeDiff() server-vs-local gate
import ImportModal from './components/import-modal.js';
import SettingsModal from './components/settings-modal.js';
import CustomStatsPopup from './components/custom-stats-popup.js';
import SkillSection from './components/skill-section.js';
import ReputationSection from './components/reputation-section.js';
import OwnedItemsSection from './components/owned-items-section.js';
import GearSetManager from './components/gear-set-manager.js';
import FilterCheckboxes from './components/filter-checkboxes.js';
import GearSlotGrid from './components/gear-slot-grid.js';
import ItemSelectionPopup from './components/item-selection-popup.js';
import ActionButtons from './components/action-buttons.js';
import CombinedStatsSection from './components/combined-stats-section.js';
import NonOwnedUpgradesSection from './components/nonowned-upgrades-section.js';
import ActivitySelectorDropdown from './components/activity-selector-dropdown.js';
import RecipeSelectorDropdown from './components/recipe-selector-dropdown.js';
import { StatsReportPage } from './stats-report-page.js';
// Stats-report stale-detection broadcast (debounced funnel for state mutations).
// See ui/static/js/stats-report-stale-broadcast.js + .kiro/specs/stats-report-stale-detection/.
import './stats-report-stale-broadcast.js';
import { refreshStaleAnnotations } from './stats-report-stale-annotator.js';
window.refreshStatsReportStaleAnnotations = refreshStaleAnnotations;
// Active Debug Session swap button (caterpillar icon in nav header)
import { initActiveDebugSwapButton } from './active-debug-link.js';
import ActivityInfoSection from './components/activity-info-section.js';
import RecipeInfoSection from './components/recipe-info-section.js';
import OptimizeButton from './components/optimize-button.js';
import DropsSection from './components/drops-section.js';
import CalculatorSection from './components/calculator-section.js';
import UndoRedoButtons from './components/undo-redo-buttons.js';
import undoRedoManager from './undo-redo.js';
import { initBugReport, openBugReportModal } from './bug_report.js';
import { initAboutModal, showInfoModal } from './about.js';
import { initHelpModal, showHelpModal } from './help.js';
import { initAnnouncementsModal } from './announcements.js';
import { initPullToRefresh, switchToTab, TAB_ORDER } from './pull-to-refresh.js';
import TravelConfigPage from './travel-config-page.js';
import { SellForChipsPage } from './sell-for-chips-page.js';
import { WalkdlePage } from './walkdle-page.js';
import { NotepadPage } from './notepad-page.js';
import TravelMap from './travel-map.js';
import GearsetComparisonSection from './components/gearset-comparison-section.js';
import { initAprilFools } from './april-fools.js';
import { getInstantActionsPet } from './utils/pet-utils.js';

/**
 * Get session UUID from cookie or generate new one
 * @returns {string} Session UUID
 */
function getSessionUuid() {
    // Check for existing cookie
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'session_uuid') {
            return value;
        }
    }

    // Generate new UUID
    const uuid = crypto.randomUUID();

    // Set cookie (expires in 1 year)
    document.cookie = `session_uuid=${uuid}; path=/; max-age=31536000`;

    return uuid;
}

/**
 * Initialize the application
 */
async function initializeApp() {
    console.log('=== initializeApp START ===');
    window.__walkscapePerf?.mark('init_start');
    // Seed default for "show item finding drops in target drop" before any component
    // reads it. Several consumers read localStorage directly (=== 'true'), so an unset
    // value must be materialized here to keep them consistent with the settings checkbox.
    // Default ON; an explicit opt-out (stored 'false') is preserved.
    if (localStorage.getItem('showItemFindingDrops') === null) {
        localStorage.setItem('showItemFindingDrops', 'true');
    }
    // Initialize April Fools effects early — gated behind feature flag (checked after flags load)
    // We call it immediately but it will check window._featureFlags.april_fools before activating
    initAprilFools();
    try {
        // Show loading indicator
        showLoadingIndicator();

        // Get or create session UUID
        const uuid = getSessionUuid();
        console.log('Session UUID:', uuid);

        // Load session data from backend
        window.__walkscapePerf?.mark('session_start');
        await store.loadSession(uuid);
        window.__walkscapePerf?.measure('session_load', 'session_start');
        window.dispatchEvent(new Event('session-loaded'));
        // Small summary always; full state only when ?debug=1 / localStorage walkscape_debug=1
        const _ch = store.state.character || {};
        console.log('[INIT] Session loaded:', {
            uuid: store.state.session?.uuid,
            character: _ch.name || null,
            owned_items: Array.isArray(_ch.owned_items) ? _ch.owned_items.length : 0,
            ui_keys: store.state.ui ? Object.keys(store.state.ui).length : 0,
            items_state_count: store.state.items ? Object.keys(store.state.items).length : 0,
        });
        if (window.__walkscapeVerboseDebug) {
            console.log('[VERBOSE] Session loaded full state:', store.state);
        }

        // Fetch static data from API
        window.__walkscapePerf?.mark('static_data_start');
        const [itemsData, skillsData] = await Promise.all([
            api.getItems(),
            api.getSkills()
        ]);
        window.__walkscapePerf?.measure('static_data_load', 'static_data_start');

        const _itemsCats = itemsData?.categories || {};
        console.log('[INIT] Items loaded:', {
            categories: Object.keys(_itemsCats),
            materials: Array.isArray(_itemsCats.materials) ? _itemsCats.materials.length : 0,
            collectibles: _itemsCats.collectibles ? Object.keys(_itemsCats.collectibles).length : 0,
            chests: _itemsCats.chests ? Object.keys(_itemsCats.chests).length : 0,
            pets: Array.isArray(_itemsCats.pets) ? _itemsCats.pets.length : 0,
        });
        if (window.__walkscapeVerboseDebug) {
            console.log('[VERBOSE] Items loaded full payload:', itemsData);
        }
        console.log('Skills loaded:', skillsData);

        // Hide loading indicator
        hideLoadingIndicator();

        // Check feature flags BEFORE rendering components (so generic UI is included)
        try {
            window.__walkscapePerf?.mark('flags_start');
            const flagsResp = await fetch('/api/feature-flags');
            window.__walkscapePerf?.measure('feature_flags_load', 'flags_start');
            if (flagsResp.ok) {
                const flags = await flagsResp.json();
                window._featureFlags = flags;
                console.log('Feature flags loaded:', flags);
                // Resume an in-progress client-side goals-report run if one
                // survived a page reload (fire-and-forget; no-op otherwise).
                try { maybeResumeLocalGoalsReport(); } catch (e) { /* ignore */ }
                // Schedule the once-per-browser local-speed benchmark (idle,
                // FAC/snapshot/disable-gated inside). Powers the "your device is
                // faster than the server" nudge.
                try { initLocalSpeedBenchmark(); } catch (e) { /* ignore */ }
                if (flags.travel) {
                    $('#travel-nav-btn').show();
                    $('#travel-tab').show();
                }
                if (flags.crafting_tree) {
                    $('#crafting-tree-nav-btn').show();
                }
                if (flags.stats_report) {
                    $('#stats-report-nav-btn').show();
                }
                if (flags.pin_item) {
                    $('#pin-mode-btn').show();
                }
                if (flags.sell_for_chips) {
                    $('#sell-for-chips-nav-btn').show();
                }
                if (flags.walkdle) {
                    $('#walkdle-nav-btn').show();
                }
                if (flags.notepad) {
                    $('#notepad-nav-btn').show();
                }
            }
        } catch (err) {
            console.warn('Failed to load feature flags:', err);
        }

        // Active Debug Session swap button — show after API check (or
        // localStorage cache hit on the snapshot session). Same "wait for
        // verification, no flash" pattern as the FAC-gated icons above.
        initActiveDebugSwapButton().catch(err => console.warn('[active-debug-link] init failed:', err));

        // Show crafting tree button if feature flag is enabled
        // (handled below with feature flags)

        // Load generic items if feature flag is enabled (before rendering)
        if (window._featureFlags?.generic) {
            try {
                const uuid = store.state.session?.uuid;
                if (uuid) {
                    // Detect stale cached api.js that's missing generic methods
                    if (typeof api.getGenericDefinitions !== 'function') {
                        console.error('Stale api.js detected (missing getGenericDefinitions). Forcing reload.');
                        window.location.reload(true);
                        return;
                    }
                    const defs = await api.getGenericDefinitions(uuid);
                    store.state.genericItems = defs.items || [];
                    console.log(`Loaded ${store.state.genericItems.length} generic items`);

                    // If "Show community definitions" was saved as checked, load community items too
                    if (store.state.column1?.showGenericItemCommunity) {
                        try {
                            const community = await api.getCommunityDefinitions();
                            const communityItems = community.items || [];
                            const existingIds = new Set(store.state.genericItems.map(i => i.id));
                            const existingNames = new Set(store.state.genericItems.map(i => (i.name || '').toLowerCase()));
                            const newItems = communityItems.filter(ci =>
                                !existingIds.has(ci.id) && !existingNames.has((ci.name || '').toLowerCase())
                            );
                            store.state.communityGenericItems = newItems;
                            store.state.genericItems = [...store.state.genericItems, ...newItems.map(ci => ({ ...ci, _community: true }))];
                            console.log(`Loaded ${newItems.length} community generic items`);
                        } catch (err) {
                            console.warn('Failed to load community generic items on init:', err);
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed to load generic items:', err);
                store.state.genericItems = [];
            }
        }

        // Match generic items against raw export names by export_item_name
        if (store.state.genericItems && store.state.genericItems.length > 0 && store.state.character?.raw_export_names) {
            const rawSet = new Set(store.state.character.raw_export_names.map(n => n.toLowerCase()));
            const raritySuffixes = ['_ethereal', '_legendary', '_epic', '_rare', '_uncommon', '_common'];
            const rarityToQuality = {
                '_common': 'Normal', '_uncommon': 'Good', '_rare': 'Great',
                '_epic': 'Excellent', '_legendary': 'Perfect', '_ethereal': 'Eternal'
            };
            const qualityHierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];

            // Build overrides in bulk, then persist with a single store.update()
            // Previously this mutated store.state.items directly which never synced
            // to the backend, so the optimizer never saw generic items as owned.
            const existingOverrides = store.state.ui?.user_overrides?.items || {};
            const newOverrides = { ...existingOverrides };
            let matchCount = 0;

            for (const gi of store.state.genericItems) {
                const exportName = gi.export_item_name;
                if (!exportName) continue;

                const stateId = `generic::item::${gi.id}`;
                const exportLower = exportName.toLowerCase();

                if (gi.is_crafted) {
                    // Crafted: check for export_name + quality suffix, find best
                    let bestQuality = null;
                    let secondQuality = null;
                    for (const suffix of raritySuffixes) {
                        if (rawSet.has(exportLower + suffix)) {
                            const q = rarityToQuality[suffix];
                            if (!bestQuality || qualityHierarchy.indexOf(q) < qualityHierarchy.indexOf(bestQuality)) {
                                secondQuality = bestQuality;
                                bestQuality = q;
                            } else if (!secondQuality || qualityHierarchy.indexOf(q) < qualityHierarchy.indexOf(secondQuality)) {
                                secondQuality = q;
                            }
                        }
                    }
                    if (bestQuality) {
                        newOverrides[stateId] = {
                            ...(newOverrides[stateId] || {}),
                            has: true,
                            quality: bestQuality,
                            ring1_quality: bestQuality,
                            ring2_quality: secondQuality || 'None',
                        };
                        matchCount++;
                        console.log(`Generic item "${gi.name}" matched owned (crafted, quality: ${bestQuality}${secondQuality ? ', ring2: ' + secondQuality : ''})`);
                    } else if (rawSet.has(exportLower)) {
                        // Fallback: some crafted items (e.g. input-slot items like arrows)
                        // are exported without quality suffixes — match bare name
                        // Also check for _fine variant (input items use Normal/Fine, not rarity names)
                        const hasFine = rawSet.has(exportLower + '_fine');
                        newOverrides[stateId] = {
                            ...(newOverrides[stateId] || {}),
                            has: true,
                            quality: hasFine ? 'Fine' : 'Normal',
                        };
                        matchCount++;
                        console.log(`Generic item "${gi.name}" matched owned (crafted, bare name fallback${hasFine ? ', has fine' : ''})`);
                    } else if (rawSet.has(exportLower + '_fine')) {
                        // Only fine version exists (no normal)
                        newOverrides[stateId] = {
                            ...(newOverrides[stateId] || {}),
                            has: true,
                            quality: 'Fine',
                        };
                        matchCount++;
                        console.log(`Generic item "${gi.name}" matched owned (crafted, fine only)`);
                    }
                } else {
                    // Non-crafted: exact match
                    if (rawSet.has(exportLower)) {
                        newOverrides[stateId] = {
                            ...(newOverrides[stateId] || {}),
                            has: true,
                        };
                        matchCount++;
                        console.log(`Generic item "${gi.name}" matched owned`);
                    }
                }
            }

            // Single update to persist all matches to backend
            if (matchCount > 0) {
                store.update('ui.user_overrides.items', newOverrides);
                console.log(`Matched ${matchCount} generic items from character export`);
            }
        }

        // Render all components (now with feature flags and generic items available)
        window.__walkscapePerf?.mark('render_components_start');
        renderComponents(itemsData, skillsData);
        window.__walkscapePerf?.measure('render_components', 'render_components_start');

        // Initialize the Pin Item controller (singleton). Idempotent — safe
        // to call multiple times. Reads ui.pinned_state and re-creates any
        // persisted pins. Gated behind the `pin_item` feature flag so
        // non-enrolled sessions don't re-mount their old pin state either.
        if (window._featureFlags?.pin_item) {
            try {
                const { default: pinnedController } = await import('./pinned-container-controller.js');
                pinnedController.init();
            } catch (pinErr) {
                console.error('Failed to initialize pinned container controller:', pinErr);
            }
        }

        // Initialize modals
        console.log('About to initialize modals...');
        try {
            window.__walkscapePerf?.mark('modals_init_start');
            initializeModals();
            window.__walkscapePerf?.measure('modals_init', 'modals_init_start');
            console.log('Modals initialized successfully');
        } catch (modalError) {
            console.error('Error initializing modals:', modalError);
        }

        // Check if we need to show import modal
        console.log('About to call checkImportModal()...');
        checkImportModal();
        console.log('checkImportModal() completed');

        // Auto-enable the skydisc course custom stats when the player owns
        // the corresponding skydisc — owning the reward proves the course
        // was completed, so the requirement is satisfied.
        autoCheckOwnedSkydiscCustomStats();

        // Clean up tools stuck in locked slots (from gearsets saved before this fix)
        cleanUpLockedToolSlots();

        // Expose getInstantActionsPet globally for OptimizeButton (avoids circular import)
        window._getInstantActionsPet = getInstantActionsPet;

        // Handle initial hash after everything is ready
        if (window.location.hash === '#travel-config') {
            if (window._featureFlags?.travel) {
                handleHashChange();
            } else {
                // No access — clear hash and stay on main page
                history.replaceState(null, '', window.location.pathname);
            }
        } else if (window.location.hash === '#crafting-tree') {
            if (window._featureFlags?.crafting_tree) {
                handleHashChange();
            } else {
                history.replaceState(null, '', window.location.pathname);
            }
        } else if (window.location.hash === '#goals-report') {
            if (window._featureFlags?.stats_report) {
                handleHashChange();
            } else {
                history.replaceState(null, '', window.location.pathname);
            }
        } else if (window.location.hash === '#sell-for-chips') {
            if (window._featureFlags?.sell_for_chips) {
                handleHashChange();
            } else {
                history.replaceState(null, '', window.location.pathname);
            }
        } else if (window.location.hash === '#walkdle') {
            if (window._featureFlags?.walkdle) {
                handleHashChange();
            } else {
                history.replaceState(null, '', window.location.pathname);
            }
        } else if (window.location.hash === '#notepad') {
            if (window._featureFlags?.notepad) {
                handleHashChange();
            } else {
                history.replaceState(null, '', window.location.pathname);
            }
        }

    } catch (error) {
        console.error('Failed to initialize app:', error);
        hideLoadingIndicator();
        api.showError('Failed to initialize application. Please refresh the page.');
    }
}

/**
 * Show loading indicator
 */
function showLoadingIndicator() {
    const $loading = $(`
        <div class="loading-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        ">
            <div style="
                text-align: center;
                color: var(--text-primary);
            ">
                <div style="
                    font-size: 1.5em;
                    margin-bottom: var(--spacing-md);
                ">Loading...</div>
                <div style="
                    width: 50px;
                    height: 50px;
                    border: 3px solid var(--border-color);
                    border-top-color: var(--accent-primary);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto;
                "></div>
            </div>
        </div>
    `);

    $('body').append($loading);

    // Add spin animation if not already defined
    if (!$('#spin-animation').length) {
        $('head').append(`
            <style id="spin-animation">
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        `);
    }
}

/**
 * Hide loading indicator
 */
function hideLoadingIndicator() {
    $('.loading-overlay').fadeOut(300, function () {
        $(this).remove();
    });
}

/**
 * Render all components in column 1 and column 2
 * @param {Object} itemsData - Items catalog data from API
 * @param {Object} skillsData - Skills data from API
 */
function renderComponents(itemsData, skillsData) {
    // ========================================
    // Column 1: Character Data
    // ========================================
    const $column1Content = $('#column-1 .column-content');

    // Clear existing content
    $column1Content.empty();

    // Add Import Data and Custom Stats buttons at the top
    const $buttonContainer = $(`
        <div class="button-container" style="
            display: flex;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-lg);
            justify-content: center;
        ">
            <button class="button button-primary" id="import-data-btn">
                Import Data
            </button>
            <button class="button" id="custom-stats-btn">
                Custom Stats
            </button>
        </div>
    `);
    $column1Content.append($buttonContainer);

    // Create containers for each section
    const $skillsContainer = $('<div id="skills-section"></div>');
    const $reputationContainer = $('<div id="reputation-section"></div>');
    const $itemsContainer = $('<div id="owned-items-section"></div>');

    $column1Content.append($skillsContainer);
    $column1Content.append($reputationContainer);
    $column1Content.append($itemsContainer);

    // Initialize Skills & AP section
    const skillsByCategory = {
        Gathering: skillsData.skills.filter(s => s.category === 'Gathering'),
        Artisan: skillsData.skills.filter(s => s.category === 'Artisan'),
        Utility: skillsData.skills.filter(s => s.category === 'Utility')
    };

    new SkillSection($skillsContainer, {
        skills: skillsData.skills,
        byCategory: skillsByCategory
    });

    // Initialize Faction Reputation section
    new ReputationSection($reputationContainer);

    // Initialize Owned Items section
    new OwnedItemsSection($itemsContainer, {
        catalog: itemsData
    });

    // ========================================
    // Column 2: Gear Stats
    // ========================================
    const $gearSetManagerContainer = $('#gear-set-manager');
    const $filterCheckboxesContainer = $('#filter-checkboxes');
    const $gearSlotGridContainer = $('#gear-slot-grid');
    const $actionButtonsContainer = $('#action-buttons');
    const $nonOwnedUpgradesContainer = $('#nonowned-upgrades-section');
    const $combinedStatsContainer = $('#combined-stats-section');

    // Get character level for tool slot calculation
    const characterLevel = calculateCharacterLevel(store.state.character);

    // Create item selection popup (append to body for modal overlay)
    const $popupContainer = $('<div id="item-selection-popup"></div>');
    $('body').append($popupContainer);
    const itemSelectionPopup = new ItemSelectionPopup($popupContainer);
    window.itemSelectionPopup = itemSelectionPopup;  // Expose for Column 3 input item slots

    // Initialize Column 2 components
    window.gearSetManager = new GearSetManager($gearSetManagerContainer);
    new FilterCheckboxes($filterCheckboxesContainer);
    new GearSlotGrid($gearSlotGridContainer, {
        characterLevel: characterLevel,
        catalog: itemsData,
        onSlotClick: (slot) => {
            console.log('Opening item selection popup for slot:', slot);
            itemSelectionPopup.show(slot);
        }
    });
    new ActionButtons($actionButtonsContainer);

    // Load item finding categories eagerly (fire and forget)
    // Categories will be available by the time user interacts with stats
    fetch('/api/item-finding-categories')
        .then(response => response.json())
        .then(data => {
            window.itemFindingCategories = data;
            console.log('Loaded item finding categories:', Object.keys(data).length);
        })
        .catch(error => {
            console.error('Failed to load item finding categories:', error);
            window.itemFindingCategories = {};
        });

    // Store CombinedStatsSection globally for Column 3 integration
    // Requirements: 7.1, 7.2, 7.3, 7.4
    window.combinedStatsSection = new CombinedStatsSection($combinedStatsContainer, {
        catalog: itemsData
    });

    // Aggregated "Non-owned/Locked Upgrades" section (column 2, above Combined
    // Stats). Reads store.state.gearsets.alternatives/lockedAlternatives —
    // populated by the optimizer — and renders one ranked row per item.
    window.nonOwnedUpgradesSection = new NonOwnedUpgradesSection($nonOwnedUpgradesContainer);

    // ========================================
    // Column 3: Activity/Craft Selection
    // ========================================
    const $activitySelectorContainer = $('#activity-selector-dropdown');
    const $recipeSelectorContainer = $('#recipe-selector-dropdown');
    const $activityRecipeInfoContainer = $('#activity-recipe-info');
    const $dropsSectionContainer = $('#drops-section');
    const $calculatorSectionContainer = $('#calculator-section');

    // Create separate containers for activity and recipe info
    const $activityInfoContainer = $('<div id="activity-info-container"></div>');
    const $recipeInfoContainer = $('<div id="recipe-info-container"></div>');
    $activityRecipeInfoContainer.append($activityInfoContainer);
    $activityRecipeInfoContainer.append($recipeInfoContainer);

    // Initialize Column 3 components
    window.activitySelector = new ActivitySelectorDropdown($activitySelectorContainer);
    window.recipeSelector = new RecipeSelectorDropdown($recipeSelectorContainer);

    // Add optimize button container after selectors
    const $optimizeButtonContainer = $('<div id="optimize-button-container"></div>');
    $recipeSelectorContainer.after($optimizeButtonContainer);
    window.optimizeButton = new OptimizeButton($optimizeButtonContainer);

    // Add comparison view checkbox right below optimize button
    // Only show for sessions with the comparison_view feature flag
    const $comparisonToggle = $(`
        <div id="comparison-toggle" class="comparison-toggle-container">
            <label class="comparison-toggle-label">
                <span>Comparison view:</span>
                <input type="checkbox" id="comparison-mode-checkbox" />
            </label>
        </div>
    `);
    $optimizeButtonContainer.after($comparisonToggle);
    // Comparison view is available to all users

    // Add comparison section container right after the checkbox
    const $comparisonContainer = $('<div id="gearset-comparison-section"></div>');
    $comparisonToggle.after($comparisonContainer);

    // Initialize comparison section
    window.gearsetComparisonSection = new GearsetComparisonSection($comparisonContainer);


    // Initialize comparison controls in Column 2 (gearset 1/2 toggle)
    const $comparisonControls = $('#comparison-controls');
    const $col2Content = $('#column-2 .column-content');
    const $col2 = $('#column-2');

    function renderComparisonControls() {
        if (!store.state.gearsets.comparisonMode) {
            $comparisonControls.html('').removeClass('active pinned').css({ position: '', left: '', width: '', top: '', zIndex: '' });
            $comparisonControls.next('.comparison-controls-spacer').remove();
            return;
        }
        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
        $comparisonControls.html(`
            <div class="gearset-slot-toggle">
                <div class="gearset-slot-slider" style="transform: translateX(${activeSlot === 1 ? '0' : '100%'})"></div>
                <button class="gearset-slot-btn ${activeSlot === 1 ? 'active' : ''}" data-slot="1">Gear Set 1</button>
                <button class="gearset-slot-btn ${activeSlot === 2 ? 'active' : ''}" data-slot="2">Gear Set 2</button>
            </div>
        `).addClass('active');

        // Pin immediately — don't wait for scroll or timeout
        const isMobile = window.innerWidth < 769;
        if (isMobile) {
            // On mobile, use sticky positioning within the scroll container
            $comparisonControls.addClass('pinned').css({
                position: 'sticky',
                top: '0',
                left: '',
                width: '100%',
                zIndex: 500,
            });
        } else {
            const $scroller = getScrollContainer();
            if ($scroller.length) {
                const scrollerRect = $scroller[0].getBoundingClientRect();
                const h = $comparisonControls[0].offsetHeight;
                $comparisonControls.addClass('pinned').css({
                    position: 'fixed',
                    top: scrollerRect.top + 'px',
                    left: scrollerRect.left + 'px',
                    width: scrollerRect.width + 'px',
                    zIndex: 500,
                });
                if (!$comparisonControls.next('.comparison-controls-spacer').length) {
                    $comparisonControls.after(`<div class="comparison-controls-spacer" style="height:${h}px"></div>`);
                }
            }
        }
    }
    // Don't call renderComparisonControls yet — getScrollContainer needs to be defined first

    // Pinning logic: always pin the controls at the top of column 2 when comparison mode is active
    // Works for both desktop (.column-content scrolls) and mobile (.column-2 scrolls)
    function getScrollContainer() {
        // On mobile, .column-2 itself scrolls; on desktop, .column-content scrolls
        const isMobile = window.innerWidth < 769;
        return isMobile ? $col2 : $col2Content;
    }

    // Now render (getScrollContainer is defined)
    renderComparisonControls();

    function updatePinned() {
        if (!$comparisonControls.hasClass('active')) return;
        const isMobile = window.innerWidth < 769;

        // On mobile, sticky handles everything — just ensure it's set
        if (isMobile) {
            if (!$comparisonControls.hasClass('pinned')) {
                $comparisonControls.addClass('pinned').css({
                    position: 'sticky',
                    top: '0',
                    left: '',
                    width: '100%',
                    zIndex: 500,
                });
            }
            return;
        }

        const $scroller = getScrollContainer();
        const controlsEl = $comparisonControls[0];
        if (!controlsEl) return;

        // Always pin when comparison mode is active — keeps the toggle at the top
        if (!$comparisonControls.hasClass('pinned')) {
            const scrollerRect = $scroller[0].getBoundingClientRect();
            const h = controlsEl.offsetHeight;
            $comparisonControls.addClass('pinned').css({
                position: 'fixed',
                top: scrollerRect.top + 'px',
                left: scrollerRect.left + 'px',
                width: scrollerRect.width + 'px',
                zIndex: 500,
            });
            // Add spacer to prevent layout jump
            $comparisonControls.data('spacer-height', h);
            if (!$comparisonControls.next('.comparison-controls-spacer').length) {
                $comparisonControls.after(`<div class="comparison-controls-spacer" style="height:${h}px"></div>`);
            }
        } else {
            // Update position in case of resize/scroll
            const scrollerRect = $scroller[0].getBoundingClientRect();
            $comparisonControls.css({
                top: scrollerRect.top + 'px',
                left: scrollerRect.left + 'px',
                width: scrollerRect.width + 'px',
            });
        }
    }

    $col2Content.on('scroll', updatePinned);
    $col2.on('scroll', updatePinned);
    $(window).on('resize', updatePinned);

    // Wire up comparison mode checkbox
    $(document).on('change', '#comparison-mode-checkbox', function () {
        const enabled = $(this).is(':checked');
        if (enabled) {
            // Auto-copy current gearset to gearset 2 when enabling comparison
            store.state.gearsets.gearset2 = { ...store.state.gearsets.current };
            store.state.gearsets.gearset2SavedName = store.state.gearsets.selectedName || 'Gear set 2';
            store._notifySubscribers('gearsets.gearset2');
            store._saveGearset2();

            // Initialize both gearset contexts from current Column 3 state
            const currentCtx = {
                selectedService: store.state.column3.selectedService,
                selectedLocation: store.state.column3.selectedLocation,
                useFine: store.state.column3.useFine,
                // Copy the single-view input slot selections (e.g. arrows for Lizard
                // Hunting) into both gearset contexts so the comparison section picks
                // them up in onActivityChange via gs1Context/gs2Context.selectedInputItems.
                selectedInputItems: { ...(store.state.column3.selectedInputItems || {}) }
            };
            store.state.gearsets.gs1Context = { ...currentCtx };
            store.state.gearsets.gs2Context = { ...currentCtx };
            store.state.gearsets.activeGearsetSlot = 1;
            // Persist contexts to backend
            store._syncToBackend('ui.gearsets.gs1Context', store.state.gearsets.gs1Context);
            store._syncToBackend('ui.gearsets.gs2Context', store.state.gearsets.gs2Context);
        }
        store.toggleComparisonMode(enabled);
        renderComparisonControls();

        // Hide/show normal info + drops sections — comparison section replaces them entirely
        const $infoSection = $('#activity-recipe-info');
        const $dropsSection = $('#drops-section');
        if (enabled) {
            $infoSection.hide();
            $dropsSection.hide();
        } else {
            $infoSection.show();
            $dropsSection.show();
            // Re-render Column 2 combined stats with single view's input items
            if (window.combinedStatsSection) {
                window.combinedStatsSection._slotContentCache = { 1: null, 2: null };
                window.combinedStatsSection._renderPreservingScroll();
            }
        }
    });

    // Restore comparison mode from session on load
    store.subscribe('gearsets.comparisonMode', () => {
        const enabled = store.state.gearsets.comparisonMode;
        console.log('[Comparison] comparisonMode subscriber fired, enabled:', enabled);
        $('#comparison-mode-checkbox').prop('checked', enabled);
        console.log('[Comparison] Checkbox checked state set to:', enabled);
        const $infoSection = $('#activity-recipe-info');
        const $dropsSection = $('#drops-section');
        if (enabled) {
            $infoSection.hide();
            $dropsSection.hide();
            renderComparisonControls();
        } else {
            $infoSection.show();
            $dropsSection.show();
            renderComparisonControls();
        }
    });

    // Wire up gearset slot toggle buttons
    $comparisonControls.on('click', '.gearset-slot-btn', function () {
        const oldSlot = store.state.gearsets.activeGearsetSlot || 1;
        const newSlot = parseInt($(this).data('slot'));
        if (oldSlot === newSlot) return;

        // In comparison mode, gsXContext is the source of truth (updated directly by comparison section).
        // Don't overwrite it from column3 — just restore column3 from the new slot's context.
        const oldCtxKey = oldSlot === 1 ? 'gs1Context' : 'gs2Context';

        // Switch active slot
        store.state.gearsets.activeGearsetSlot = newSlot;

        // Animate slider
        const $slider = $comparisonControls.find('.gearset-slot-slider');
        $slider.css('transform', newSlot === 1 ? 'translateX(0)' : 'translateX(100%)');
        $comparisonControls.find('.gearset-slot-btn').removeClass('active');
        $(this).addClass('active');

        // Restore Column 3 context for the new slot
        const newCtxKey = newSlot === 1 ? 'gs1Context' : 'gs2Context';
        const newCtx = store.state.gearsets[newCtxKey] || {};
        store.state.column3.selectedService = newCtx.selectedService;
        store.state.column3.selectedLocation = newCtx.selectedLocation;
        store.state.column3.useFine = newCtx.useFine;

        // Persist both contexts to backend for reload
        store._syncToBackend('ui.gearsets.gs1Context', store.state.gearsets.gs1Context);
        store._syncToBackend('ui.gearsets.gs2Context', store.state.gearsets.gs2Context);

        // Notify Column 3 components to update
        store._notifySubscribers('column3.selectedService');
        store._notifySubscribers('column3.selectedLocation');
        store._notifySubscribers('column3.useFine');

        // Trigger grid re-render
        store._notifySubscribers('gearsets.current');
    });

    // Keyboard shortcut: press 1 or 2 to switch gearset slots (when comparison mode is active)
    $(document).on('keydown', function (e) {
        // Ignore if typing in an input/textarea/select
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
        if (!store.state.gearsets.comparisonMode) return;
        if (e.key !== '1' && e.key !== '2') return;

        const newSlot = parseInt(e.key);
        const oldSlot = store.state.gearsets.activeGearsetSlot || 1;
        if (oldSlot === newSlot) return;

        // In comparison mode, gsXContext is the source of truth — don't overwrite from column3
        const oldCtxKey = oldSlot === 1 ? 'gs1Context' : 'gs2Context';

        // Switch active slot
        store.state.gearsets.activeGearsetSlot = newSlot;

        // Animate slider
        const $slider = $comparisonControls.find('.gearset-slot-slider');
        $slider.css('transform', newSlot === 1 ? 'translateX(0)' : 'translateX(100%)');
        $comparisonControls.find('.gearset-slot-btn').removeClass('active');
        $comparisonControls.find(`.gearset-slot-btn[data-slot="${newSlot}"]`).addClass('active');

        // Restore Column 3 context for the new slot
        const newCtxKey = newSlot === 1 ? 'gs1Context' : 'gs2Context';
        const newCtx = store.state.gearsets[newCtxKey] || {};
        store.state.column3.selectedService = newCtx.selectedService;
        store.state.column3.selectedLocation = newCtx.selectedLocation;
        store.state.column3.useFine = newCtx.useFine;

        // Persist both contexts to backend for reload
        store._syncToBackend('ui.gearsets.gs1Context', store.state.gearsets.gs1Context);
        store._syncToBackend('ui.gearsets.gs2Context', store.state.gearsets.gs2Context);

        // Notify Column 3 components to update
        store._notifySubscribers('column3.selectedService');
        store._notifySubscribers('column3.selectedLocation');
        store._notifySubscribers('column3.useFine');

        // Trigger grid re-render
        store._notifySubscribers('gearsets.current');
    });

    // Global top-bar hotkeys
    // A = Announcements, B = Bug Report, S = Settings, ? or I = Info (About), H = Help, T = Travel, C = Crafting Tree, O = Optimized Goals Report
    $(document).on('keydown', function (e) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (localStorage.getItem('hotkeysEnabled') === 'false') return;

        switch (e.key) {
            case 'a': case 'A':
                e.preventDefault();
                document.getElementById('announcements-btn')?.click();
                break;
            case 'b': case 'B':
                e.preventDefault();
                openBugReportModal();
                break;
            case 's': case 'S':
                e.preventDefault();
                document.getElementById('settings-btn')?.click();
                break;
            case '?': case 'i': case 'I':
                e.preventDefault();
                showInfoModal('about');
                break;
            case 'h': case 'H':
                e.preventDefault();
                showInfoModal('help');
                break;
            case 't': case 'T':
                if (window._featureFlags?.travel) {
                    e.preventDefault();
                    document.getElementById('travel-nav-btn')?.click();
                }
                break;
            case 'c': case 'C':
                if (window._featureFlags?.crafting_tree) {
                    e.preventDefault();
                    document.getElementById('crafting-tree-nav-btn')?.click();
                }
                break;
            case 'o': case 'O':
                if (window._featureFlags?.stats_report) {
                    e.preventDefault();
                    document.getElementById('stats-report-nav-btn')?.click();
                }
                break;
            case 'm': case 'M':
                if (window._featureFlags?.sell_for_chips) {
                    e.preventDefault();
                    document.getElementById('sell-for-chips-nav-btn')?.click();
                }
                break;
        }
    });

    // Initialize both info sections in their own containers
    window.activityInfoSection = new ActivityInfoSection($activityInfoContainer);
    window.recipeInfoSection = new RecipeInfoSection($recipeInfoContainer);

    // Initialize drops section
    window.dropsSection = new DropsSection($dropsSectionContainer);

    // Initialize calculator section
    window.calculatorSection = new CalculatorSection($calculatorSectionContainer);

    // ========================================
    // Undo/Redo Buttons (Fixed Position)
    // ========================================
    const $undoRedoContainer = $('<div id="undo-redo-container"></div>');
    $('body').append($undoRedoContainer);
    new UndoRedoButtons($undoRedoContainer);

    // Subscribe undo/redo manager to gearset changes
    undoRedoManager.subscribeToChanges();

    // Initialize with current state after session is loaded
    // Use setTimeout to ensure all components have finished rendering
    setTimeout(() => {
        undoRedoManager.initialize();

        // Explicitly restore comparison mode checkbox after all components are ready
        if (store.state.gearsets.comparisonMode) {
            console.log('[Comparison] Post-init: restoring comparison mode UI');
            $('#comparison-mode-checkbox').prop('checked', true);
            $('#activity-recipe-info').hide();
            $('#drops-section').hide();
            renderComparisonControls();
        }
    }, 100);

    // ========================================
    // Travel Config Page
    // ========================================
    const travelConfigPage = new TravelConfigPage('#travel-config-page');
    window.travelConfigPage = travelConfigPage;

    // ========================================
    // Stats Report Page
    // ========================================
    const statsReportPage = new StatsReportPage('#stats-report-page');
    window._statsReportPage = statsReportPage;

    // Wire stats report nav button
    $('#stats-report-nav-btn').on('click', () => {
        if (window.location.hash === '#goals-report') {
            // Already open — navigate back
            window.location.hash = '';
        } else {
            window.location.hash = '#goals-report';
        }
    });

    // ========================================
    // Sell for Chips Page
    // ========================================
    const sellForChipsPage = new SellForChipsPage('#sell-for-chips-page');
    window._sellForChipsPage = sellForChipsPage;
    // Hash-routed like the crafting tree / goals report so the single
    // handleHashChange() chokepoint mutually closes the other report overlays
    // (and clears this icon's active state) when another one is opened.
    $('#sell-for-chips-nav-btn').on('click', () => {
        if (window.location.hash === '#sell-for-chips') {
            // Already open — clear hash to close
            window.location.hash = '';
        } else {
            window.location.hash = '#sell-for-chips';
        }
    });

    // ========================================
    // Walkdle (daily puzzle) Page
    // ========================================
    const walkdlePage = new WalkdlePage('#walkdle-page');
    window._walkdlePage = walkdlePage;
    // Hash-routed like the other report overlays so the single
    // handleHashChange() chokepoint mutually closes them.
    $('#walkdle-nav-btn').on('click', () => {
        if (window.location.hash === '#walkdle') {
            window.location.hash = '';
        } else {
            window.location.hash = '#walkdle';
        }
    });

    // ========================================
    // Notepad Page (FAC-gated)
    // ========================================
    const notepadPage = new NotepadPage('#notepad-page');
    window._notepadPage = notepadPage;
    // Hash-routed like the other report overlays so the single
    // handleHashChange() chokepoint mutually closes them.
    $('#notepad-nav-btn').on('click', () => {
        if (window.location.hash === '#notepad') {
            window.location.hash = '';
        } else {
            window.location.hash = '#notepad';
        }
    });

    // TravelMap is initialized lazily on first navigation to avoid loading
    // Leaflet tiles before the user visits the page.
    let _initTravelMapPromise = null;
    window._initTravelMap = () => {
        if (window.travelMap) return Promise.resolve();
        if (_initTravelMapPromise) return _initTravelMapPromise;
        _initTravelMapPromise = (async () => {
            const mapContainer = document.getElementById('travel-map-container');
            if (!mapContainer) return;
            const travelMap = new TravelMap(mapContainer);
            await travelMap.init();
            window.travelMap = travelMap;
            travelConfigPage.travelMap = travelMap;
            // Wire route click → scroll config panel to the relevant gearset
            travelMap.onRouteClick = (routeId, faction) => {
                travelConfigPage.scrollToRoute(routeId, faction);
            };
        })();
        return _initTravelMapPromise;
    };

    console.log('All components rendered');
    window.__walkscapePerf?.measure('initializeApp_total', 'init_start');
    window.__walkscapePerf?.report();
}

/**
 * XP equation algorithm for character level (matches Python xp_equate)
 * @param {number} level - Level
 * @returns {number} XP value
 */
function xpEquate(level) {
    return Math.floor(level + 300 * Math.pow(2, level / 7));
}

/**
 * Calculate XP needed to reach a character level (matches Python xp_to_level_character)
 * @param {number} level - Target level
 * @returns {number} Total XP needed
 */
function xpToLevelCharacter(level) {
    let xp = 0;
    for (let i = 1; i <= level; i++) {
        xp += xpEquate(i);
    }
    return Math.floor(xp / 4) * 4.6;
}

/**
 * Calculate character level from total steps (matches Python character_level_from_steps)
 * @param {number} steps - Total steps across all skills
 * @returns {number} Character level
 */
function characterLevelFromSteps(steps) {
    let charLevel = 1;
    while (charLevel < 999) {
        const requiredXp = xpToLevelCharacter(charLevel + 1);
        if (steps < requiredXp) {
            break;
        }
        charLevel++;
    }
    // +1 to match the game's display level (game starts at level 1, not 0)
    return charLevel + 1;
}

/**
 * Calculate character level from character state
 * @param {Object} character - Character object from store state
 * @returns {number} Character level
 */
function calculateCharacterLevel(character) {
    if (!character) {
        return 1;
    }

    // Use character.steps directly (total steps across all skills)
    if (character.steps) {
        return characterLevelFromSteps(character.steps);
    }

    // Fallback: calculate from skills_xp if steps not available
    if (character.skills_xp && Object.keys(character.skills_xp).length > 0) {
        const totalSteps = Object.values(character.skills_xp).reduce((sum, xp) => sum + xp, 0);
        return characterLevelFromSteps(totalSteps);
    }

    return 1;
}

// Expose globally so components (GearSlotGrid, ItemSelectionPopup) can use it
window.calculateCharacterLevel = calculateCharacterLevel;

/**
 * Remove tools from locked slots on page load.
 * Fixes gearsets saved before the import-time check was added.
 */
function cleanUpLockedToolSlots() {
    const character = store.state.character;
    const characterLevel = calculateCharacterLevel(character);
    const unlockedToolSlots = GearSlotGrid.getUnlockedToolSlots(characterLevel);
    const currentGear = store.state.gearsets?.current || {};
    const removed = [];

    for (let i = unlockedToolSlots; i < 6; i++) {
        const slot = `tool${i}`;
        if (currentGear[slot]) {
            const item = currentGear[slot];
            removed.push(`${item.name || 'Unknown'} from Tool ${i + 1}`);
            store.updateGearSlot(slot, null);
        }
    }

    if (removed.length > 0) {
        console.log(`Cleaned up ${removed.length} tool(s) in locked slots: ${removed.join(', ')}`);
        api.showWarning(
            `Removed ${removed.length} tool${removed.length > 1 ? 's' : ''} from locked slot${removed.length > 1 ? 's' : ''}: ${removed.join(', ')}`,
            { duration: 10000 }
        );
    }
}

/**
 * Initialize modals and attach to buttons
 */
function initializeModals() {
    // Create modal containers
    const $importModalContainer = $('<div id="import-modal-container"></div>');
    const $settingsModalContainer = $('<div id="settings-modal-container"></div>');
    const $customStatsContainer = $('<div id="custom-stats-container"></div>');

    $('body').append($importModalContainer);
    $('body').append($settingsModalContainer);
    $('body').append($customStatsContainer);

    // Initialize modals
    const importModal = new ImportModal($importModalContainer, {
        isFirstVisit: false,
        onImportSuccess: () => {
            // Reload page to refresh all data
            window.location.reload();
        },
        onCancel: () => {
            // Modal closed, nothing to do
        }
    });

    const settingsModal = new SettingsModal($settingsModalContainer);
    window.settingsModal = settingsModal; // Make globally accessible
    const customStatsPopup = new CustomStatsPopup($customStatsContainer);

    // Attach button handlers
    $('#settings-btn').on('click', () => {
        settingsModal.show();
    });

    $(document).on('click', '#import-data-btn', () => {
        importModal.show();
    });

    $(document).on('click', '#custom-stats-btn', () => {
        customStatsPopup.show();
    });

    // Clickable custom-stat requirements (activity_completion, access) open the Custom Stats popup
    $(document).on('click', '[data-open-custom-stats]', (e) => {
        e.stopPropagation();
        if (window.customStatsPopup) {
            window.customStatsPopup.show();
        }
    });

    // Initialize bug report
    initBugReport();

    // Initialize info modal (About + Help tabs)
    initAboutModal();

    // Initialize announcements modal
    initAnnouncementsModal();

    // Animation reroll buttons (april fools) — shown/hidden by april-fools.js
    $('#randomize-gear-btn, #randomize-activity-btn, #randomize-animations-col1-btn').on('click', () => {
        if (window.rerollAprilFoolsAnimations) window.rerollAprilFoolsAnimations();
    });

    // Store modal instances globally for access from other components
    window.importModal = importModal;
    window.settingsModal = settingsModal;
    window.customStatsPopup = customStatsPopup;

    // Wire travel nav button (desktop header) — toggles between main and travel
    $('#travel-nav-btn').on('click', () => {
        // Close crafting tree if open
        if (window._craftingTreeViewGlobal) {
            const $ct = $('#crafting-tree-container');
            $ct.addClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            if (window.location.hash === '#crafting-tree') {
                history.replaceState(null, '', window.location.pathname);
            }
            setTimeout(() => {
                $ct.hide().removeClass('closing');
                if (window._craftingTreeViewGlobal) {
                    window._craftingTreeViewGlobal.destroy();
                    window._craftingTreeViewGlobal = null;
                }
            }, 250);
        }
        if (window.location.hash === '#travel-config') {
            navigateFromTravelConfig();
        } else {
            navigateToTravelConfig();
        }
    });

    // Wire crafting tree nav button — toggle open/close
    $('#crafting-tree-nav-btn').on('click', () => {
        // If already open, close it
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.addClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            if (window.location.hash === '#crafting-tree') {
                history.replaceState(null, '', window.location.pathname);
            }
            setTimeout(() => {
                $container.hide().removeClass('closing');
                if (window._craftingTreeViewGlobal) {
                    window._craftingTreeViewGlobal.destroy();
                    window._craftingTreeViewGlobal = null;
                }
            }, 250);
            return;
        }
        // Close travel if open
        if (window.location.hash === '#travel-config') {
            navigateFromTravelConfig();
        }
        const savedItemId = store.get('ui.crafting_tree.target_item_id');
        window._openCraftingTreeGlobal(savedItemId || null);
    });

    // Global crafting tree opener — reusable from anywhere
    window._openCraftingTreeGlobal = function (itemId) {
        import('./components/crafting-tree-view.js').then(({ default: CraftingTreeView }) => {
            let $container = $('#crafting-tree-container');
            if (!$container.length) {
                $container = $('<div id="crafting-tree-container" class="crafting-tree-overlay"></div>');
                $('body').append($container);
            }
            if (window._craftingTreeViewGlobal) {
                window._craftingTreeViewGlobal.destroy();
            }
            $container.show().removeClass('closing');
            $('#crafting-tree-nav-btn').addClass('active');
            document.body.classList.add('crafting-tree-open');
            document.body.classList.remove('travel-page-open', 'stats-report-open');
            // Set hash so page can be reloaded to the same state
            if (window.location.hash !== '#crafting-tree') {
                window.location.hash = 'crafting-tree';
            }
            window._craftingTreeViewGlobal = new CraftingTreeView($container[0], {
                itemId: itemId,
                onClose: () => {
                    $container.addClass('closing');
                    $('#crafting-tree-nav-btn').removeClass('active');
                    document.body.classList.remove('crafting-tree-open');
                    // Clear hash when closing
                    if (window.location.hash === '#crafting-tree') {
                        history.replaceState(null, '', window.location.pathname);
                    }
                    setTimeout(() => {
                        $container.hide().removeClass('closing');
                        if (window._craftingTreeViewGlobal) {
                            window._craftingTreeViewGlobal.destroy();
                            window._craftingTreeViewGlobal = null;
                        }
                    }, 250);
                },
            });
        }).catch(err => {
            console.error('Failed to load CraftingTreeView:', err);
            if (window.api) window.api.showError('Failed to open Crafting Tree');
        });
    };

    // Wire header title click — navigate back to main columns from travel page
    $('#header-title').on('click', () => {
        if (window.location.hash === '#travel-config') {
            navigateFromTravelConfig();
        }
    });

    console.log('Modals initialized');
}

/**
 * Check if we need to show the import modal
 * Shows automatically if:
 * - No character_config exists
 * - User hasn't skipped import (ui.skipped_import is false)
 */
/**
 * Auto-check the skydisc course custom stats based on item ownership.
 *
 * The Golden/Red skydisc each require completing a skydisc course
 * (jarvonia_skydisc_course / gdte_skydisc_course). Owning the skydisc
 * proves the course was completed, so if the player owns the item we
 * enable the matching custom stat (persisted to ui_config) so the item is
 * not treated as locked. Idempotent — only writes when not already set.
 */
function autoCheckOwnedSkydiscCustomStats() {
    const items = store.state.items || {};
    const OWNED_TO_CUSTOM_STAT = {
        golden_skydisc: 'jarvonia_skydisc_course',
        red_skydisc: 'gdte_skydisc_course',
    };

    if (!store.state.ui.custom_stats) {
        store.state.ui.custom_stats = {};
    }
    const cs = store.state.ui.custom_stats;

    Object.entries(OWNED_TO_CUSTOM_STAT).forEach(([itemId, statId]) => {
        if (items[itemId] && cs[statId] !== true) {
            cs[statId] = true;
            // Persist to ui_config (server-side, keyed by session UUID)
            store.update(`ui.custom_stats.${statId}`, true);
            console.log(`Auto-enabled custom stat '${statId}' (owns ${itemId})`);
        }
    });
}

function checkImportModal() {
    console.log('=== checkImportModal START ===');
    if (window.__walkscapeVerboseDebug) {
        console.log('[VERBOSE] checkImportModal full state:', store.state);
    }

    const hasCharacterData = store.state.character &&
        Object.keys(store.state.character).length > 0 &&
        store.state.character.skills &&
        Object.keys(store.state.character.skills).length > 0;

    const hasSkippedImport = store.state.ui && store.state.ui.skipped_import;

    console.log('Import modal check:', {
        hasCharacterData,
        hasSkippedImport,
        'character exists': !!store.state.character,
        'character keys': store.state.character ? Object.keys(store.state.character) : 'N/A',
        'character.skills exists': !!store.state.character?.skills,
        'character.skills keys': store.state.character?.skills ? Object.keys(store.state.character.skills) : 'N/A',
        'ui exists': !!store.state.ui,
        'ui.skipped_import': store.state.ui?.skipped_import,
        'ui.skipped_import type': typeof store.state.ui?.skipped_import
    });

    // Show import modal if no character data and user hasn't skipped
    if (!hasCharacterData && !hasSkippedImport) {
        console.log('✓ Conditions met - Showing import modal (first visit)');

        // Create a first-visit import modal
        const $firstVisitModalContainer = $('<div id="first-visit-modal-container"></div>');
        $('body').append($firstVisitModalContainer);

        const firstVisitModal = new ImportModal($firstVisitModalContainer, {
            isFirstVisit: true,
            onImportSuccess: (response, hasSeenCustomStats) => {
                console.log('Import successful, hasSeenCustomStats:', hasSeenCustomStats);

                const hasSeenHelp = store.state.ui && store.state.ui.has_seen_help;

                // If user hasn't seen custom stats popup, show it before help/reload
                if (!hasSeenCustomStats) {
                    console.log('Showing custom stats popup for first time');

                    // Mark as seen immediately
                    store.update('ui.has_seen_custom_stats', true);

                    // Show custom stats popup
                    if (window.customStatsPopup) {
                        window.customStatsPopup.show();

                        // After custom stats, show help if not seen
                        const originalHide = window.customStatsPopup.hide.bind(window.customStatsPopup);
                        window.customStatsPopup.hide = function () {
                            originalHide();
                            console.log('Custom stats popup closed');

                            // Check if user has seen help
                            if (!hasSeenHelp) {
                                console.log('Showing help modal for first time');
                                store.update('ui.has_seen_help', true);

                                // Show help modal
                                showHelpModal();

                                // Reload after info modal closes
                                const infoModal = document.getElementById('info-modal');
                                const infoOk = document.getElementById('info-ok');
                                const infoClose = document.getElementById('info-close');

                                const reloadAfterHelp = () => {
                                    console.log('Info modal closed, reloading...');
                                    window.location.reload();
                                };

                                if (infoOk) infoOk.addEventListener('click', reloadAfterHelp, { once: true });
                                if (infoClose) infoClose.addEventListener('click', reloadAfterHelp, { once: true });
                                if (infoModal) {
                                    infoModal.addEventListener('click', (e) => {
                                        if (e.target === infoModal) reloadAfterHelp();
                                    }, { once: true });
                                }
                            } else {
                                console.log('User has already seen help, reloading...');
                                window.location.reload();
                            }
                        };
                    } else {
                        // Fallback: just reload if popup not available
                        console.warn('customStatsPopup not available, reloading immediately');
                        window.location.reload();
                    }
                } else {
                    // Already seen custom stats, just reload
                    console.log('User has already seen custom stats, reloading...');
                    window.location.reload();
                }
            },
            onCancel: () => {
                // User cancelled, skipped_import flag already set by modal
                console.log('User skipped import');
            }
        });

        // Show the modal
        firstVisitModal.show();
    } else {
        console.log('✗ Conditions NOT met - Modal will not show');
        console.log('  Reason:', hasCharacterData ? 'Has character data' : 'User skipped import');
    }
    console.log('=== checkImportModal END ===');
}

/**
 * Navigate to the Travel Config page (#travel-config)
 */
function navigateToTravelConfig() {
    window.location.hash = 'travel-config';
}

/**
 * Navigate away from Travel Config back to the main columns view
 */
function navigateFromTravelConfig() {
    history.replaceState(null, '', window.location.pathname);
    showMainColumns();
}

/**
 * Navigate to the Crafting Tree (#crafting-tree)
 */
function navigateToCraftingTree(itemId) {
    window.location.hash = 'crafting-tree';
    // _openCraftingTreeGlobal is wired after renderComponents — call it if ready
    if (window._openCraftingTreeGlobal) {
        window._openCraftingTreeGlobal(itemId || null);
    }
}

/**
 * Navigate away from Crafting Tree back to the main columns view
 */
function navigateFromCraftingTree() {
    history.replaceState(null, '', window.location.pathname);
    if (window._craftingTreeViewGlobal) {
        const $container = $('#crafting-tree-container');
        $container.addClass('closing');
        $('#crafting-tree-nav-btn').removeClass('active');
        document.body.classList.remove('crafting-tree-open');
        setTimeout(() => {
            $container.hide().removeClass('closing');
            if (window._craftingTreeViewGlobal) {
                window._craftingTreeViewGlobal.destroy();
                window._craftingTreeViewGlobal = null;
            }
        }, 250);
    }
}

/**
 * Show the travel config page, hide main columns
 */
async function showTravelConfigPage() {
    $('#travel-config-page').css('display', 'flex');
    $('.main-content').css('display', 'none');
    document.body.classList.add('travel-page-open');
    document.body.classList.remove('crafting-tree-open', 'stats-report-open');
    // Update mobile tab active state
    $('.mobile-tab').removeClass('active');
    $('.mobile-tab[data-column="travel-config-page"]').addClass('active');
    // Mark desktop travel button as active
    $('#travel-nav-btn').addClass('active');

    try {
        // Initialize TravelMap lazily on first visit — await so routes are loaded before ConfigPanel
        if (window._initTravelMap) await window._initTravelMap();
    } catch (err) {
        console.error('Failed to initialize TravelMap:', err);
    }

    // Notify TravelConfigPage if it exists
    if (window.travelConfigPage && window.travelConfigPage.onNavigatedTo) {
        window.travelConfigPage.onNavigatedTo();
    }
}

/**
 * Animated close for the stats report page. Mirrors the close path
 * inside showMainColumns() so any code that sends the user away from
 * #stats-report gets the same fade-out instead of a hard hide().
 * Safe to call when the page isn't visible — degrades to a cheap
 * style cleanup.
 */
function closeStatsReportPage() {
    const $srPage = $('#stats-report-page');
    document.body.classList.remove('stats-report-open');
    if ($srPage.is(':visible')) {
        $srPage.removeClass('opening').addClass('closing');
        setTimeout(() => {
            $srPage.removeClass('closing').css('display', 'none');
        }, 260);
    } else {
        $srPage.css('display', 'none').removeClass('opening closing');
    }
    $('#stats-report-nav-btn').removeClass('active');
    if (window._statsReportPage && window._statsReportPage.onNavigatedFrom) {
        window._statsReportPage.onNavigatedFrom();
    }
}

/**
 * Show main columns, hide travel config page
 */
function showMainColumns() {
    $('#travel-config-page').css('display', 'none');
    document.body.classList.remove('travel-page-open', 'crafting-tree-open');
    // Animate stats report page closed if visible — delegates to the
    // shared helper so the close transition stays consistent across all
    // exit paths (back button, nav-elsewhere, ESC).
    closeStatsReportPage();
    $('.main-content').css({ display: '', visibility: 'visible' });
    // Remove active state from desktop travel buttons (stats-report btn
    // already cleared by closeStatsReportPage())
    $('#travel-nav-btn').removeClass('active');
    // Restore active tab to column-1 if no tab is active
    const hasActive = $('.mobile-tab.active').length > 0;
    if (!hasActive || $('.mobile-tab.active').data('column') === 'travel-config-page') {
        $('.mobile-tab').removeClass('active');
        $('.mobile-tab[data-column="column-1"]').addClass('active');
    }
    // Notify TravelConfigPage if it exists
    if (window.travelConfigPage && window.travelConfigPage.onNavigatedAway) {
        window.travelConfigPage.onNavigatedAway();
    }
}

/**
 * Handle anchor-based routing for #travel-config and #crafting-tree
 */
function handleHashChange() {
    // Walkdle overlay closes on any navigation; the '#walkdle' branch below
    // reopens it. close() is idempotent so this is safe to run unconditionally.
    if (window._walkdlePage && window.location.hash !== '#walkdle') {
        window._walkdlePage.close();
    }
    // Notepad overlay closes on any navigation; the '#notepad' branch below
    // reopens it. close() is idempotent so this is safe to run unconditionally.
    if (window._notepadPage && window.location.hash !== '#notepad') {
        window._notepadPage.close();
    }
    if (window.location.hash === '#travel-config') {
        // Close crafting tree if open
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            if (window._craftingTreeViewGlobal) {
                window._craftingTreeViewGlobal.destroy();
                window._craftingTreeViewGlobal = null;
            }
        }
        // Close stats report if open (animated — matches the .closing
        // CSS keyframes already declared for this element).
        if (window._statsReportPage) {
            closeStatsReportPage();
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        showTravelConfigPage();
    } else if (window.location.hash === '#crafting-tree') {
        // Close travel if open
        showMainColumns();
        // Close stats report if open (animated)
        if (window._statsReportPage) {
            closeStatsReportPage();
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        const savedItemId = window.store ? window.store.get('ui.crafting_tree.target_item_id') : null;
        if (window._openCraftingTreeGlobal) {
            window._openCraftingTreeGlobal(savedItemId || null);
        }
    } else if (window.location.hash === '#goals-report') {
        // Guard: redirect if feature not enabled
        if (!window._featureFlags?.stats_report) {
            window.location.hash = '';
            return;
        }
        // Close other full-page views
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            window._craftingTreeViewGlobal.destroy();
            window._craftingTreeViewGlobal = null;
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        // Hide main columns (same as travel config)
        $('.main-content').css('display', 'none');
        // Show stats report page with open animation
        const $srPage = $('#stats-report-page');
        $srPage.removeClass('closing').addClass('opening').css('display', 'block');
        $('#stats-report-nav-btn').addClass('active');
        document.body.classList.add('stats-report-open');
        document.body.classList.remove('travel-page-open', 'crafting-tree-open');
        if (window._statsReportPage) {
            window._statsReportPage.onNavigatedTo();
        }
    } else if (window.location.hash === '#sell-for-chips') {
        // Guard: redirect if feature not enabled
        if (!window._featureFlags?.sell_for_chips) {
            window.location.hash = '';
            return;
        }
        // Close the other report overlays (mirror the goals-report branch).
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            window._craftingTreeViewGlobal.destroy();
            window._craftingTreeViewGlobal = null;
        }
        if (window._statsReportPage) {
            closeStatsReportPage();
        }
        // If the travel config page is showing, restore the main columns
        // first — the sell-for-chips overlay only dims .main-content via a
        // body class; it doesn't cover the separately-shown travel page.
        if (document.body.classList.contains('travel-page-open')) {
            showMainColumns();
        }
        // open() handles its own visibility (body.sell-for-chips-open hides
        // .main-content via CSS) and sets the nav icon active.
        if (window._sellForChipsPage) {
            window._sellForChipsPage.open();
        }
    } else if (window.location.hash === '#walkdle') {
        // Guard: redirect if feature not enabled
        if (!window._featureFlags?.walkdle) {
            window.location.hash = '';
            return;
        }
        // Close the other report overlays (mirror the sell-for-chips branch).
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            window._craftingTreeViewGlobal.destroy();
            window._craftingTreeViewGlobal = null;
        }
        if (window._statsReportPage) {
            closeStatsReportPage();
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        if (document.body.classList.contains('travel-page-open')) {
            showMainColumns();
        }
        if (window._walkdlePage) {
            window._walkdlePage.open();
        }
    } else if (window.location.hash === '#notepad') {
        // Guard: redirect if feature not enabled
        if (!window._featureFlags?.notepad) {
            window.location.hash = '';
            return;
        }
        // Close the other report overlays (mirror the walkdle branch).
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            window._craftingTreeViewGlobal.destroy();
            window._craftingTreeViewGlobal = null;
        }
        if (window._statsReportPage) {
            closeStatsReportPage();
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        if (document.body.classList.contains('travel-page-open')) {
            showMainColumns();
        }
        if (window._notepadPage) {
            window._notepadPage.open();
        }
    } else {
        // Close crafting tree if open (back button / hash cleared)
        if (window._craftingTreeViewGlobal) {
            const $container = $('#crafting-tree-container');
            $container.hide().removeClass('closing');
            $('#crafting-tree-nav-btn').removeClass('active');
            document.body.classList.remove('crafting-tree-open');
            if (window._craftingTreeViewGlobal) {
                window._craftingTreeViewGlobal.destroy();
                window._craftingTreeViewGlobal = null;
            }
        }
        // Close stats report if open
        // Close stats report if open — animated, mirrors the close
        // path inside showMainColumns() so back-button / hash-cleared
        // exits get the same fade-out as the other navigation paths.
        // (Was calling .hide() directly which skipped the .closing
        // animation the user noticed missing 2026-05-21.)
        if (window._statsReportPage && $('#stats-report-page').is(':visible')) {
            closeStatsReportPage();
        }
        if (window._sellForChipsPage) {
            window._sellForChipsPage.close();
        }
        showMainColumns();
    }
}

// Expose navigation helpers globally
window.navigateToTravelConfig = navigateToTravelConfig;
window.navigateFromTravelConfig = navigateFromTravelConfig;
window.navigateToCraftingTree = navigateToCraftingTree;
window.navigateFromCraftingTree = navigateFromCraftingTree;

/**
 * Initialize when DOM is ready
 */
$(document).ready(() => {
    console.log('DOM ready, initializing app...');

    // Apply saved custom colors
    const savedTertiary = localStorage.getItem('customBgTertiary');
    if (savedTertiary) {
        document.documentElement.style.setProperty('--bg-tertiary', savedTertiary);
    }

    const savedHover = localStorage.getItem('customBgHover');
    if (savedHover) {
        document.documentElement.style.setProperty('--bg-hover', savedHover);
    }

    // Apply saved popup auto-collapse min-heights (in vh). Only set the
    // CSS var when a non-default value was saved.
    const savedTopMin = localStorage.getItem('popupAutoCollapseTopMin');
    if (savedTopMin) {
        document.documentElement.style.setProperty('--popup-auto-collapse-top-min', `${savedTopMin}vh`);
    }
    const savedAltMin = localStorage.getItem('popupAutoCollapseAltMin');
    if (savedAltMin) {
        document.documentElement.style.setProperty('--popup-auto-collapse-alt-min', `${savedAltMin}vh`);
    }
    const savedListMin = localStorage.getItem('popupItemListMin');
    if (savedListMin && savedListMin !== '0') {
        document.documentElement.style.setProperty('--popup-item-list-min', `${savedListMin}vh`);
    }

    // Wire anchor-based routing for #travel-config
    window.addEventListener('hashchange', handleHashChange);

    // When the user changes thousand/decimal separator prefs, force every
    // already-rendered view to refresh by notifying the same top-level state
    // paths used during initial load. The patched Number.prototype.toLocaleString
    // and the formatFixed() helper read prefs on every call, so a re-render is
    // all that's needed for visible numbers to pick up the new format.
    window.addEventListener('numberFormatChanged', () => {
        const refreshPaths = [
            'session', 'character', 'items', 'ui', 'gearsets',
            'column3.selectedActivity', 'column3.selectedRecipe',
            'column3.selectedService', 'column3.selectedLocation',
            'column3.useFine', 'column3.hideOwnedCollectibles',
            'column3.travelStart', 'column3.travelEnd',
        ];
        for (const path of refreshPaths) {
            try { store._notifySubscribers(path); } catch (_e) { /* defensive */ }
        }
        // Some components listen to bespoke window events for live refresh
        // (e.g. combined-stats listens to hideUnapplicableStatsChanged). Fire a
        // few of those with a no-op delta so they refresh too, harmlessly.
        // We only need to nudge the ones that don't read from `store` paths.
    });

    initializeApp();
    initializeMobileTabs();
    initPullToRefresh();
});

/**
 * Initialize mobile tab navigation
 */
function initializeMobileTabs() {
    const $tabs = $('.mobile-tab');

    $tabs.on('click', function () {
        const targetColumn = $(this).data('column');
        const targetIndex = TAB_ORDER.indexOf(targetColumn);
        if (targetIndex >= 0) {
            switchToTab(targetIndex);
        }
    });
}

/**
 * Randomize gear - equip random items in all slots
 */
async function randomizeGear() {
    console.log('Randomizing gear...');

    try {
        // Fetch catalog data
        const catalogData = await api.getCatalog();
        const allItems = catalogData.items || [];

        console.log(`Total items in catalog: ${allItems.length}`);

        // Debug: Check what slots are available
        const slotCounts = {};
        allItems.forEach(item => {
            slotCounts[item.slot] = (slotCounts[item.slot] || 0) + 1;
        });
        console.log('Items by slot:', slotCounts);

        // Check if we should only use owned items
        const onlyShowOwned = store.state.ui?.column2?.showOwnedOnly || false;
        const ownedItems = store.state.character?.owned_items || [];

        console.log(`Only show owned: ${onlyShowOwned}, Owned items count: ${ownedItems.length}`);
        if (ownedItems.length > 0) {
            console.log('First 5 owned item IDs:', ownedItems.slice(0, 5));
        }
        if (allItems.length > 0) {
            console.log('First 5 catalog item IDs:', allItems.slice(0, 5).map(i => i.id));
        }

        // Get character level for tool slots
        const characterLevel = calculateCharacterLevel(store.state.character);
        const toolSlots = GearSlotGrid.getUnlockedToolSlots(characterLevel);

        console.log(`Character level: ${characterLevel}, unlocked tool slots: ${toolSlots}`);
        console.log('Character state:', store.state.character);

        // Define all slots (matching GearSlotGrid.GEAR_SLOTS layout)
        const gearSlots = ['cape', 'head', 'back', 'hands', 'chest', 'neck', 'primary', 'legs', 'secondary', 'ring1', 'feet', 'ring2'];
        const toolSlotNames = [];
        for (let i = 0; i < toolSlots; i++) {
            toolSlotNames.push(`tool${i}`);
        }
        const specialSlots = ['consumable', 'pet'];

        console.log('Tool slots to randomize:', toolSlotNames);

        const allSlots = [...gearSlots, ...toolSlotNames, ...specialSlots];

        // Filter items by owned if needed
        let availableItems = allItems.filter(item => {
            // Skip items with undefined slot
            if (!item.slot) {
                return false;
            }
            // Filter by owned if checkbox is checked
            if (onlyShowOwned && !ownedItems.includes(item.id)) {
                return false;
            }
            return true;
        });

        console.log(`Available items after filtering: ${availableItems.length} (owned filter: ${onlyShowOwned})`);

        // Randomize each slot
        for (const slot of allSlots) {
            // Get valid items for this slot
            let validItems = availableItems.filter(item => {
                // Match slot type - each slot should only accept items with that exact slot
                if (slot.startsWith('tool')) {
                    return item.slot === 'tools';  // Note: plural 'tools'
                } else if (slot === 'ring1' || slot === 'ring2') {
                    return item.slot === 'ring';
                } else if (slot === 'primary') {
                    return item.slot === 'primary';
                } else if (slot === 'secondary') {
                    return item.slot === 'secondary';
                } else {
                    return item.slot === slot;
                }
            });

            console.log(`Slot ${slot}: found ${validItems.length} valid items`);

            if (validItems.length === 0) {
                // No items for this slot, unequip
                console.log(`  -> Unequipping ${slot} (no valid items)`);
                store.updateGearSlot(slot, null);
                continue;
            }

            // Pick a random item
            const randomItem = validItems[Math.floor(Math.random() * validItems.length)];

            // Build complete item data (matching item-selection-popup format)
            const slotItem = {
                itemId: randomItem.id,
                uuid: randomItem.uuid || randomItem.id,
                name: randomItem.name,
                icon_path: randomItem.icon_path,
                rarity: randomItem.rarity || 'common',
                quality: randomItem.quality || null,
                keywords: randomItem.keywords || [],
                is_fine: randomItem.is_fine || false
            };

            console.log(`  -> Equipping ${randomItem.name} to ${slot}`);

            // Equip it
            store.updateGearSlot(slot, slotItem);
        }

        console.log('Gear randomized!');
    } catch (error) {
        console.error('Failed to randomize gear:', error);
    }
}

/**
 * Randomize activity or recipe selection
 */
async function randomizeActivityOrRecipe() {
    console.log('Randomizing activity/recipe...');

    try {
        // Randomly choose between activity and recipe
        const useActivity = Math.random() < 0.5;

        if (useActivity) {
            // Get all activities
            const response = await $.get('/api/activities');
            const allActivities = [];

            for (const activities of Object.values(response.by_skill)) {
                allActivities.push(...activities);
            }

            if (allActivities.length === 0) {
                console.warn('No activities available');
                return;
            }

            // Pick a random activity
            const randomActivity = allActivities[Math.floor(Math.random() * allActivities.length)];

            // Update state
            if (!store.state.column3) {
                store.state.column3 = {};
            }
            store.state.column3.selectedActivity = randomActivity.id;
            store.state.column3.selectedRecipe = null;
            store.state.column3.useFine = false;

            // Notify subscribers
            store._notifySubscribers('column3.selectedActivity');
            store._notifySubscribers('column3.selectedRecipe');

            // Auto-save selection to session
            store._saveColumn3Selection();

            console.log('Random activity selected:', randomActivity.name);
        } else {
            // Get all recipes
            const response = await $.get('/api/recipes');
            const allRecipes = [];

            for (const recipes of Object.values(response.by_skill)) {
                allRecipes.push(...recipes);
            }

            if (allRecipes.length === 0) {
                console.warn('No recipes available');
                return;
            }

            // Pick a random recipe
            const randomRecipe = allRecipes[Math.floor(Math.random() * allRecipes.length)];

            // Update state
            if (!store.state.column3) {
                store.state.column3 = {};
            }
            store.state.column3.selectedRecipe = randomRecipe.id;
            store.state.column3.selectedActivity = null;
            store.state.column3.useFine = false;

            // Notify subscribers
            store._notifySubscribers('column3.selectedRecipe');
            store._notifySubscribers('column3.selectedActivity');

            // Auto-save selection to session
            store._saveColumn3Selection();

            console.log('Random recipe selected:', randomRecipe.name);
        }
    } catch (error) {
        console.error('Failed to randomize activity/recipe:', error);
    }
}

// Export for debugging
window.store = store;
window.api = api;
