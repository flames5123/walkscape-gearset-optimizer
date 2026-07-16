/**
 * CraftingTreeView — Main container for the crafting tree calculator.
 * 
 * Manages tree state, API calls, child component lifecycle.
 * Renders: GlobalSettingsPanel, TreeOverview, TreeNodeCards, SummaryDashboard.
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import GlobalSettingsPanel, { LINE_COLOR_PALETTES, DEFAULT_PALETTE } from './crafting-tree-settings.js';
import { _applyCraftingTreeColors } from './settings-modal.js';
import TreeNodeCard from './tree-node-card.js';
import { maybeShowLocalSpeedWarning } from '../local-speed-warning.js';
import TreeOverview from './tree-overview.js';
import SummaryDashboard from './crafting-tree-summary.js';
import { preloadLocationsData } from './location-dropdown.js';
import { getPetIconPath } from '../utils/pet-utils.js';

import { formatFixed } from '../utils/number-format.js';

// Bump this when the tree node format or source data changes to invalidate saved state
const TREE_DATA_VERSION = 9;

class CraftingTreeView extends Component {
    constructor(element, props = {}) {
        super(element, props);
        // props: { itemId, onClose }
        this.treeNodes = [];
        this.globalSettings = store.get('ui.crafting_tree.global_settings') || {
            target_quantity: 1, daily_steps: 10000,
            target_quality: 'Perfect', buffer_percentage: 0.05,
            spoiler_protection: true,
        };
        this.summary = null;
        this.optimizationStatus = null;
        this.childComponents = [];
        this._saveTimer = null;

        // Holistic Mode (LP) UI visibility toggle. Persisted in
        // session.ui_config.show_holistic_details so the choice
        // survives reload. The backend always runs the LP solver
        // and merges improved totals into the summary; this flag
        // only gates the per-node "Holistic Solver Insight" strips
        // (which take a lot of vertical space) and the summary
        // mode badge. User spec 2026-05-16: default OFF, checkbox
        // below the tree overview, persist in session.
        // Read the persisted value from globalSettings (which the
        // backend saves alongside other tree settings); fall back
        // to false so the default is OFF.
        window._craftingTreeShowHolisticDetails = !!(
            this.globalSettings && this.globalSettings.show_holistic_details
        );

        // Render-event debug instrumentation. Enable in DevTools with
        //   window._craftingTreeDebugRender = true
        // and reload the tree (or any source change) — every add/remove
        // of a tree-related DOM node will be logged with the offending
        // element class, data-node-id, and the parent that mutated.
        // This is for diagnosing the "middle-screen flash" the user
        // reported (2026-05-15): some element disappears + re-renders
        // mid-flight and we want to see which one. Combined with the
        // [CT-RENDER] backend-call timestamps (added in onSourceChange
        // and onMaterialPreviewCommit) the engineer can correlate
        // server logs to client mutations on a bug-report timeline.
        try {
            if (typeof MutationObserver !== 'undefined' && !this._renderObserver) {
                const root = this.$element && this.$element[0] ? this.$element[0] : document.body;
                this._renderObserver = new MutationObserver(mutations => {
                    if (!window._craftingTreeDebugRender) return;
                    for (const m of mutations) {
                        if (m.type !== 'childList') continue;
                        const summarize = (n) => {
                            if (!n || n.nodeType !== 1 /* ELEMENT */) return null;
                            const cls = (n.className && typeof n.className === 'string')
                                ? n.className
                                : (n.getAttribute && n.getAttribute('class')) || '';
                            // Filter to tree-related elements only — log spam otherwise
                            if (!/tree-|material-group/.test(cls)) return null;
                            return {
                                cls: String(cls).slice(0, 80),
                                nodeId: (n.dataset && (n.dataset.nodeId || n.dataset.childId)) || '',
                                tag: n.tagName,
                            };
                        };
                        for (const removed of m.removedNodes) {
                            const s = summarize(removed);
                            if (s) {
                                // eslint-disable-next-line no-console
                                console.log('[CT-RENDER-REMOVE]', s, 'from', summarize(m.target) || m.target);
                            }
                        }
                        for (const added of m.addedNodes) {
                            const s = summarize(added);
                            if (s) {
                                // eslint-disable-next-line no-console
                                console.log('[CT-RENDER-ADD]', s, 'into', summarize(m.target) || m.target);
                            }
                        }
                    }
                });
                this._renderObserver.observe(root, { childList: true, subtree: true });
            }
        } catch (err) { /* non-fatal — observer isn't required for normal rendering */ }

        // Undo/redo handled by global UndoRedoManager (undo-redo.js)
        // Expose this view instance on window so the manager's
        // applyState handler can find treeNodes and trigger _renderTree
        // when restoring a captured tree state. Without this, the
        // store update fires correctly but the view's local treeNodes
        // array stays at the pre-undo value and the rendered tree
        // doesn't refresh until the user reopens the crafting tree.
        window._craftingTreeViewGlobal = this;

        this._renderSkeleton();
        // Kick off the /api/locations fetch now so the module-level cache
        // inside LocationDropdown is warm before any tree nodes mount.
        // Prevents the empty -> populated flicker on no-service recipe
        // nodes after Optimize (which does a full tree re-render).
        preloadLocationsData().catch(() => {});
        // Always call loadTree — when itemId is null/undefined the
        // loadTree(null) path renders the empty tree skeleton and
        // auto-opens the recipe picker so first-time users have an
        // obvious entry point instead of a sparse empty view.
        // (User feedback 2026-05-16: "kinda sparse and not intuitive
        //  how to start using.")
        this.loadTree(props.itemId || null);
    }

    _renderSkeleton() {
        this.$element.html(`
            <div class="crafting-tree-view">
                <div class="crafting-tree-topbar">
                    <div class="crafting-tree-preset-manager">
                        <button class="button crafting-tree-preset-save" title="Save current tree">Save</button>
                        <div class="crafting-tree-preset-dropdown-btn">
                            <input type="text" class="crafting-tree-preset-name" placeholder="New Goal" maxlength="100" />
                            <button class="crafting-tree-preset-toggle"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="crafting-tree-preset-dropdown" style="display:none"></div>
                    </div>
                    <button class="button crafting-tree-close-btn">✕</button>
                </div>
                ${localStorage.getItem('craftingTreeBetaBannerDismissed') === 'true' ? '' : `
                <div class="crafting-tree-beta-banner" role="status">
                    <div class="crafting-tree-beta-banner-body">
                        <span class="crafting-tree-beta-tag">BETA</span>
                        <span class="crafting-tree-beta-text">
                            The crafting tree is in active development. Features may change, and saved goals might be reset before the final release. If you find a bug or have feedback, please report it from the bug button so we can fix it together!
                        </span>
                    </div>
                    <button class="crafting-tree-beta-dismiss" title="Dismiss this notice">✕</button>
                </div>`}
                <div class="crafting-tree-item-select-container"></div>
                <div class="crafting-tree-settings-container"></div>
                <div class="crafting-tree-lp-toggle-container"></div>
                <div class="crafting-tree-overview-container"></div>
                <div class="crafting-tree-holistic-toggle-container">
                    <label class="ct-holistic-toggle-label" title="Show per-node Holistic Solver Insight strips with byproduct flow + LP attribution">
                        <input type="checkbox" class="ct-show-holistic-details">
                        <span>Show holistic view details</span>
                    </label>
                </div>
                <div class="crafting-tree-nodes-container"></div>
                <!--
                  Manual "rerun summary" fallback. While the summary normally
                  auto-rebuilds via _calculateOnly(preserveUI:true) after any
                  source/location/gear change, the in-flight suppression rules
                  + partial render paths can occasionally leave it showing
                  stale numbers (bug 90f466cf and friends). This button is a
                  beta-only escape hatch — it lives inside the crafting tree
                  view (which is itself the beta feature) and just kicks off
                  another preserve-UI recalc to refresh the summary.
                -->
                <div class="crafting-tree-summary-refresh-wrap" style="display:none">
                    <button type="button" class="crafting-tree-summary-refresh-btn"
                            title="Recompute the summary from the current tree state">
                        <span class="ct-summary-refresh-icon">↻</span>
                        <span class="ct-summary-refresh-label">Rerun Summary</span>
                    </button>
                </div>
                <div class="crafting-tree-summary-container"></div>
            </div>
        `);
        this._attachTopbarEvents();
    }

    _attachTopbarEvents() {
        const self = this;
        this.$element.on('click', '.crafting-tree-close-btn', () => {
            self._saveTreeState();
            if (self.props.onClose) self.props.onClose();
        });
        this.$element.on('click', '.crafting-tree-calc-btn', () => {
            self.calculateAll();
        });

        // Manual "Rerun Summary" fallback button. Pure aggregation —
        // hits /api/crafting-tree/aggregate-summary which only walks the
        // existing per-node metrics and re-totals them. No per-node
        // optimizer, no LP solver, no node mutations. Result is
        // deterministic for a fixed tree state. The button replaces
        // ONLY the SummaryDashboard component below the tree.
        this.$element.on('click', '.crafting-tree-summary-refresh-btn', async function () {
            const $btn = $(this);
            if ($btn.hasClass('refreshing')) return;
            $btn.addClass('refreshing');
            try {
                const sessionUuid = store.get('session.uuid');
                const result = await api.aggregateCraftingTreeSummary(
                    self.treeNodes,
                    self.globalSettings,
                    sessionUuid
                );
                if (!result || !result.summary) {
                    console.warn('[CT-SUMMARY-REFRESH] no summary in response');
                    return;
                }
                self.summary = result.summary;
                // Re-derive displayed_cumulative_steps / _actions from the
                // existing per-node card metrics so the summary card uses
                // the buffer-scaled total (target_qty / ceil(eff)) instead
                // of the backend's raw total_steps. Without this call the
                // summary card falls through to rawSummary.total_steps,
                // which doesn't have the buffer scaling applied — and the
                // numbers jump (e.g. 383,766 → 402,428) after every Rerun
                // Summary or gearset import-without-recompute. Bug
                // 19fbf470, 2026-05-19.
                if (typeof self._annotateDisplayedCumulative === 'function') {
                    try { self._annotateDisplayedCumulative(); }
                    catch (err) { console.warn('[CT-SUMMARY-REFRESH] _annotateDisplayedCumulative failed:', err); }
                }
                // Sync the per-node card step numbers to the refreshed
                // annotated totals. Without this, "Rerun Summary" updated
                // the summary but left the component cards stale, so the
                // total still didn't match. Bug 5e9a6344.
                if (typeof self._repopulateNodeMetrics === 'function') {
                    try { self._repopulateNodeMetrics(); }
                    catch (err) { console.warn('[CT-SUMMARY-REFRESH] _repopulateNodeMetrics failed:', err); }
                }
                store.update('ui.crafting_tree.summary', self.summary);
                // Rebuild ONLY the summary dashboard; leave every per-node
                // card and its child components untouched.
                const summaryContainer = self.$element
                    .find('.crafting-tree-summary-container');
                if (!summaryContainer.length) return;
                self.childComponents = self.childComponents.filter(c => {
                    if (c && c.constructor && c.constructor.name === 'SummaryDashboard') {
                        try { c.destroy && c.destroy(); } catch (_) { /* ignore */ }
                        return false;
                    }
                    return true;
                });
                const SummaryDashboard = (await import('./crafting-tree-summary.js')).default;
                const summaryDash = new SummaryDashboard(summaryContainer[0], {
                    summary: self.summary,
                });
                self.childComponents.push(summaryDash);
                self._syncSummaryRefreshVisibility();
            } catch (err) {
                console.error('[CT-SUMMARY-REFRESH] failed:', err);
            } finally {
                $btn.removeClass('refreshing');
            }
        });

        // Holistic details checkbox (below tree overview). Toggles the
        // visibility of per-node "Holistic Solver Insight" strips and
        // the summary's "✨ Holistic Mode" badge. State is persisted
        // in global_settings.show_holistic_details so the choice
        // survives reload (per-tree, like other tree settings).
        // Default off — the strips take a lot of vertical space and
        // most users don't need to see them by default.
        this.$element.on('change', '.ct-show-holistic-details', function () {
            const checked = !!this.checked;
            window._craftingTreeShowHolisticDetails = checked;
            self.globalSettings = {
                ...(self.globalSettings || {}),
                show_holistic_details: checked,
            };
            store.update('ui.crafting_tree.global_settings', self.globalSettings);
            // Show/hide existing strips in place — no full re-render.
            // Per-node insight strips:
            const $strips = self.$element.find('.tree-node-lp-insight, .tree-node-lp-insight-clickable');
            // Summary badge (rendered by crafting-tree-summary.js).
            const $badge = self.$element.find('.crafting-tree-summary-lp-badge, .summary-lp-badge');
            if (checked) {
                $strips.slideDown(180);
                $badge.show();
            } else {
                $strips.slideUp(180);
                $badge.hide();
            }
            self._debounceSave && self._debounceSave();
        });

        // Beta banner dismiss — persist in localStorage so the user
        // doesn't see it again next session. Same pattern as the
        // settings-modal dismissible tips.
        this.$element.on('click', '.crafting-tree-beta-dismiss', (e) => {
            e.stopPropagation();
            try { localStorage.setItem('craftingTreeBetaBannerDismissed', 'true'); } catch (_) { /* noop */ }
            self.$element.find('.crafting-tree-beta-banner').slideUp(180, function () { $(this).remove(); });
        });

        // Palette button — open UI settings modal on the UI tab
        this.$element.on('click', '.ct-palette-btn', (e) => {
            e.stopPropagation();
            if (window.settingsModal) {
                window.settingsModal.activeTab = 'ui';
                window.settingsModal.show();
            }
        });

        // Preset manager
        this._presetDropdownOpen = false;
        this._presetSearchText = '';
        this._presetPendingDelete = null;
        this._currentPresetId = null;

        // Save preset
        this.$element.on('click', '.crafting-tree-preset-save', async () => {
            const name = self.$element.find('.crafting-tree-preset-name').val().trim();
            if (!name) { api.showError('Enter a name first'); return; }
            const sessionUuid = store.get('session.uuid');
            const targetItemId = store.get('ui.crafting_tree.target_item_id') || '';
            const treeData = { nodes: self.treeNodes, global_settings: self.globalSettings, summary: self.summary };
            try {
                const result = await api.saveCraftingTree(sessionUuid, name, targetItemId, treeData);
                self._currentPresetId = result.id;
                api.showSuccess(`Saved "${name}"`);
            } catch (err) { console.error(err); }
        });

        // Toggle dropdown
        this.$element.on('click', '.crafting-tree-preset-toggle', async () => {
            self._presetDropdownOpen = !self._presetDropdownOpen;
            const $dd = self.$element.find('.crafting-tree-preset-dropdown');
            const $arrow = self.$element.find('.crafting-tree-preset-toggle .expand-arrow');
            if (self._presetDropdownOpen) {
                $arrow.addClass('expanded');
                await self._renderPresetDropdown();
                $dd.slideDown(200);
                self.$element.find('.crafting-tree-preset-search').focus();
            } else {
                $arrow.removeClass('expanded');
                $dd.slideUp(150);
            }
        });

        // Search in dropdown
        this.$element.on('input', '.crafting-tree-preset-search', function () {
            self._presetSearchText = $(this).val();
            self._renderPresetList();
        });

        // "+ New Goal" click
        this.$element.on('click', '.crafting-tree-preset-new', () => {
            self._currentPresetId = null;
            self.$element.find('.crafting-tree-preset-name').val('');
            self.treeNodes = [];
            self.summary = null;
            store.update('ui.crafting_tree.nodes', []);
            store.update('ui.crafting_tree.target_item_id', '');
            self._renderTree();
            self.$element.find('.crafting-tree-preset-dropdown').slideUp(150);
            self._presetDropdownOpen = false;
            self.$element.find('.crafting-tree-preset-toggle .expand-arrow').removeClass('expanded');
            // Show item picker so user can select a recipe
            setTimeout(() => self._showItemPicker(), 150);
        });

        // Load a preset
        this.$element.on('click', '.crafting-tree-preset-item', async function (e) {
            if ($(e.target).closest('.crafting-tree-preset-delete').length) return;
            const treeId = $(this).data('tree-id');
            const sessionUuid = store.get('session.uuid');
            try {
                const result = await api.loadSavedCraftingTree(treeId, sessionUuid);
                const data = result.tree_data || {};
                self.treeNodes = data.nodes || [];
                self.globalSettings = data.global_settings || self.globalSettings;
                self.summary = data.summary || null;
                self._currentPresetId = treeId;
                // Refresh holistic-details flag from the loaded preset's
                // global_settings so the checkbox + per-node strips
                // reflect the saved choice (per-tree, default off).
                window._craftingTreeShowHolisticDetails = !!(
                    self.globalSettings && self.globalSettings.show_holistic_details
                );
                self.$element.find('.crafting-tree-preset-name').val(result.name);
                store.update('ui.crafting_tree.target_item_id', result.target_item_id);
                store.update('ui.crafting_tree.nodes', self.treeNodes);
                store.update('ui.crafting_tree.global_settings', self.globalSettings);
                self._renderTree();
                self.$element.find('.crafting-tree-preset-dropdown').slideUp(150);
                self._presetDropdownOpen = false;
                self.$element.find('.crafting-tree-preset-toggle .expand-arrow').removeClass('expanded');
                api.showSuccess(`Loaded "${result.name}"`);
            } catch (err) { console.error(err); }
        });

        // Delete a preset (two-click confirm)
        this.$element.on('click', '.crafting-tree-preset-delete', async function (e) {
            e.stopPropagation();
            const treeId = $(this).data('tree-id');
            if (self._presetPendingDelete === treeId) {
                const sessionUuid = store.get('session.uuid');
                try {
                    await api.deleteSavedCraftingTree(treeId, sessionUuid);
                    $(this).closest('.crafting-tree-preset-item').remove();
                    if (self._currentPresetId === treeId) self._currentPresetId = null;
                    api.showSuccess('Deleted');
                } catch (err) { console.error(err); }
                self._presetPendingDelete = null;
            } else {
                self._presetPendingDelete = treeId;
                $(this).text('Delete?').addClass('confirm');
                setTimeout(() => {
                    if (self._presetPendingDelete === treeId) {
                        self._presetPendingDelete = null;
                        $(this).text('×').removeClass('confirm');
                    }
                }, 3000);
            }
        });

        // Close dropdown on outside click
        $(document).on('click.ct-preset', (e) => {
            if (!$(e.target).closest('.crafting-tree-preset-manager').length && self._presetDropdownOpen) {
                self._presetDropdownOpen = false;
                self.$element.find('.crafting-tree-preset-dropdown').slideUp(150);
                self.$element.find('.crafting-tree-preset-toggle .expand-arrow').removeClass('expanded');
            }
        });

        // Escape key closes the overlay
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                self._saveTreeState();
                if (self.props.onClose) self.props.onClose();
            }
        };
        $(document).on('keydown.crafting-tree', this._escHandler);
    }

    /**
     * Return the tree-data payload used when saving a preset. Exposed so the
     * Notepad "save current tree & link" flow can persist the live tree.
     */
    getSavePayload() {
        return { nodes: this.treeNodes, global_settings: this.globalSettings, summary: this.summary };
    }

    /**
     * Load a saved crafting-tree preset by id and apply it to this view.
     * Mirrors the preset-dropdown click handler; used by the Notepad
     * entity-link deep-link (window._notepadPendingSavedTree).
     */
    async loadSavedTreeById(treeId) {
        const sessionUuid = store.get('session.uuid');
        const result = await api.loadSavedCraftingTree(treeId, sessionUuid);
        const data = result.tree_data || {};
        this.treeNodes = data.nodes || [];
        this.globalSettings = data.global_settings || this.globalSettings;
        this.summary = data.summary || null;
        this._currentPresetId = treeId;
        window._craftingTreeShowHolisticDetails = !!(this.globalSettings && this.globalSettings.show_holistic_details);
        this.$element.find('.crafting-tree-preset-name').val(result.name || '');
        store.update('ui.crafting_tree.target_item_id', result.target_item_id);
        store.update('ui.crafting_tree.nodes', this.treeNodes);
        store.update('ui.crafting_tree.global_settings', this.globalSettings);
        this._renderTree();
        try { if (window.api && api.showSuccess) api.showSuccess(`Loaded "${result.name}"`); } catch (_) { /* ignore */ }
    }

    async loadTree(itemId) {
        // Notepad deep-link: a saved-tree-link click stashes the requested
        // preset id here. Honor it instead of the plain target-item load so
        // the exact saved node layout is restored. Consume once.
        const _npPending = window._notepadPendingSavedTree;
        if (_npPending && _npPending.treeId) {
            window._notepadPendingSavedTree = null;
            try {
                await this.loadSavedTreeById(_npPending.treeId);
                return;
            } catch (e) {
                console.warn('[crafting-tree] notepad saved-tree load failed; falling back', e);
            }
        }
        // If no item specified, show the item picker
        if (!itemId) {
            this._renderTree();
            setTimeout(() => this._showItemPicker(), 100);
            return;
        }

        const sessionUuid = store.get('session.uuid');
        const spoiler = this.globalSettings.spoiler_protection;

        // Check if we have saved state for this item (version-checked to avoid stale data)
        const savedItemId = store.get('ui.crafting_tree.target_item_id');
        const savedNodes = store.get('ui.crafting_tree.nodes');
        const savedVersion = store.get('ui.crafting_tree.data_version');
        if (savedItemId === itemId && savedNodes && savedNodes.length > 0 && savedVersion === TREE_DATA_VERSION) {
            // Sanity check: the root node's item_id must match the target_item_id
            // (prevents stale cache mismatches where the root doesn't match)
            const rootNode = savedNodes.find(n => !n.parent_id);
            if (rootNode && rootNode.item_id === itemId) {
                this.treeNodes = savedNodes;
                this.summary = store.get('ui.crafting_tree.summary') || null;
                this._renderTree();
                // Refresh backend-side fields (available_locations, available_services
                // for no-service recipes, etc.) by running a calculate. This catches
                // saved trees built by older backend versions that are missing newer
                // fields.
                this._calculateOnly(true).catch(err => {
                    console.warn('Refresh calculate after load failed (non-fatal):', err);
                });
                return;
            }
            // Cache mismatch — clear and rebuild
            console.warn('Crafting tree cache mismatch: target_item_id', itemId, 'but root node is', rootNode?.item_id, '— rebuilding');
            store.update('ui.crafting_tree.nodes', null);
        }

        try {
            const result = await api.buildCraftingTree(itemId, sessionUuid, spoiler);
            this.treeNodes = result.nodes || [];
            // Clear summary + cached store summary so any stale
            // lock_warnings ('Requirements not met on N nodes' banner)
            // disappear immediately when the user changes recipe. Without
            // this, the previous tree's summary lingers under the new
            // tree until the first recalc finishes, leaving warning
            // entries pointing at deleted node ids.
            this.summary = null;
            store.update('ui.crafting_tree.summary', null);
            // Merge backend's settings (target_quantity, daily_steps,
            // target_quality, buffer_percentage, spoiler_protection)
            // OVER the user's existing settings, but keep visual prefs
            // (line_colors, custom_colors, use_fine, skip_shops) from
            // the user. The backend's build response only round-trips
            // the persisted operational settings — without this merge,
            // changing the recipe wiped the user's selected line-color
            // theme back to the backend default. User-reported:
            // "When I change the crafting tree recipe, it should keep
            //  the theme I have selected, not changing it."
            const existing = this.globalSettings || {};
            const fromServer = result.global_settings || {};
            console.log('[ct-theme] loadTree merge', {
                existing_line_colors: existing.line_colors,
                existing_custom_colors_len: (existing.custom_colors || []).length,
                fromServer_line_colors: fromServer.line_colors,
                fromServer_keys: Object.keys(fromServer),
            });
            this.globalSettings = {
                ...existing,
                ...fromServer,
                line_colors: existing.line_colors || fromServer.line_colors,
                custom_colors: existing.custom_colors || fromServer.custom_colors,
                use_fine: existing.use_fine !== undefined ? existing.use_fine : fromServer.use_fine,
                skip_shops: existing.skip_shops !== undefined ? existing.skip_shops : fromServer.skip_shops,
            };
            console.log('[ct-theme] after merge', {
                line_colors: this.globalSettings.line_colors,
                custom_colors_len: (this.globalSettings.custom_colors || []).length,
            });
            store.update('ui.crafting_tree.target_item_id', itemId);
            store.update('ui.crafting_tree.data_version', TREE_DATA_VERSION);
            store.update('ui.crafting_tree.nodes', this.treeNodes);
            store.update('ui.crafting_tree.global_settings', this.globalSettings);
            this._renderTree();
        } catch (err) {
            api.showError('Failed to build crafting tree');
            console.error(err);
        }
    }

    async calculateAll() {
        // Bail if the tree has no goal yet — show a friendly notice
        // instead of letting _calculateOnly silently no-op or, worse,
        // POST nodes=[] to /api/crafting-tree/calculate which returns
        // 400 "nodes is required" and surfaces a generic
        // "Failed to calculate crafting tree" toast that confuses
        // users who haven't started yet. Bug report 2940ca83.
        if (!this.treeNodes || this.treeNodes.length === 0) {
            api.showError('Add a goal to your tree first.');
            return;
        }
        // One-time "device faster" nudge — gate BEFORE the calculate so the
        // popup appears immediately on click, not after the ~1s calculate pass.
        try { await maybeShowLocalSpeedWarning(); } catch (_) { /* non-fatal */ }
        const sessionUuid = store.get('session.uuid');
        // Set the optimizing-all flag FIRST, before any _calculateOnly
        // await that can re-render the tree and clobber the button DOM
        // reference. _updateMainOptimizeButtonState re-finds the button
        // by class selector each call, so it always hits the current
        // live element — even after a full _renderTree.
        this._isOptimizingAll = true;
        this._optimizingNodeIds = this._optimizingNodeIds || new Set();
        this._updateMainOptimizeButtonState();

        try {
            // First calculate metrics — suppress button reset since we continue to optimize
            await this._calculateOnly(true);

            // _calculateOnly may have rebuilt the tree DOM. Re-sync the
            // button state so the spinner survives the re-render.
            this._updateMainOptimizeButtonState();

            // Then optimize all non-bank/non-shop nodes
            const nodeIds = this.treeNodes
                .filter(n => n.source_type !== 'bank' && n.source_type !== 'best' && n.source_type !== 'shop')
                .map(n => n.node_id);
            const bestNodes = this.treeNodes
                .filter(n => n.source_type === 'best' && n.underlying_source_type !== 'bank' && n.underlying_source_type !== 'shop')
                .map(n => n.node_id);
            const allNodeIds = [...nodeIds, ...bestNodes];

            if (allNodeIds.length > 0) {
                this._optimizingNodeIds = new Set(allNodeIds);
                this._updateMainOptimizeButtonState();

                // Clear stale LP data from the pre-optimization calculate pass.
                // The LP ran with old gear stats — those numbers are meaningless now.
                // They'll be recomputed correctly after optimization completes.
                for (const node of this.treeNodes) {
                    if (node.metrics) {
                        delete node.metrics.lp_data;
                    }
                }
                // Also clear the summary LP mode so the badge doesn't show stale state
                if (this.summary) {
                    this.summary.lp_mode = 'off';
                }

                // Set loading state on all individual optimize buttons
                for (const nid of allNodeIds) {
                    this.$element.find(`.tree-btn-optimize[data-node-id="${nid}"]`)
                        .addClass('optimizing').prop('disabled', true)
                        .html('<span class="spinner">⏳</span>');
                    // Blank each card's header steps/item + body totals.
                    // User reads stale numbers otherwise while the worker
                    // runs. Re-populated on complete by rerenderAll.
                    this._clearNodeMetrics(nid);
                }
                await api.optimizeCraftingTree(
                    this.treeNodes, this.globalSettings, sessionUuid, allNodeIds, true
                );
                this._pollOptimization(sessionUuid);
            } else {
                // No nodes to optimize — clear the optimizing-all state.
                this._isOptimizingAll = false;
                this._updateMainOptimizeButtonState();
            }
        } catch (err) {
            api.showError('Failed to calculate/optimize crafting tree');
            console.error(err);
            this._isOptimizingAll = false;
            this._optimizingNodeIds = new Set();
            this._updateMainOptimizeButtonState();
        }
    }

    async _calculateOnly(suppressButtonReset = false, preserveUI = false) {
        console.log('[LOC-FLICKER] _calculateOnly start', { preserveUI, suppressButtonReset });
        // Empty tree (no goal yet) is a valid state — e.g. user closed
        // the auto-opened recipe picker without picking, or the picker
        // silently failed to load the tree (bug 2940ca83 picker race).
        // Calling the API with nodes=[] hits a 400 "nodes is required"
        // and surfaces a generic "Failed to calculate crafting tree"
        // toast on every option toggle. Skip the call entirely; reset
        // the button so the spinner doesn't get stuck.
        if (!this.treeNodes || this.treeNodes.length === 0) {
            console.log('[LOC-FLICKER] _calculateOnly: empty tree, skipping API call');
            if (!suppressButtonReset) {
                const $btn = this.$element.find('.crafting-tree-calc-btn');
                $btn.removeClass('optimizing').prop('disabled', false)
                    .text('Calculate & Optimize All');
            }
            return;
        }
        console.trace('[LOC-FLICKER] _calculateOnly call stack');
        const sessionUuid = store.get('session.uuid');
        try {
            const result = await api.calculateCraftingTree(
                this.treeNodes, this.globalSettings, sessionUuid
            );
            console.log('[LOC-FLICKER] _calculateOnly got result, choosing path', { preserveUI, hasNodes: !!result.nodes });
            if (preserveUI && result.nodes) {
                // Lightweight update path used by interactions that shouldn't
                // cause the whole tree to refresh (e.g. location dropdown
                // selection). Mutate existing node objects in place so live
                // TreeNodeCard instances still reference the updated data,
                // then refresh only the summary dashboard. This preserves
                // LocationDropdown internal state and avoids the
                // "dropdown disappears and reappears" flicker.
                console.log('[LOC-FLICKER] _calculateOnly: PRESERVE-UI PATH taken (no _renderTree)');
                const nodesById = {};
                for (const n of this.treeNodes) nodesById[n.node_id] = n;
                let mutatedCount = 0;
                for (const fresh of result.nodes) {
                    const existing = nodesById[fresh.node_id];
                    if (!existing) continue;
                    // Overlay new computed fields; keep UI-local markers
                    // (last_auto_resolved_location, gear_config cache, etc.).
                    existing.metrics = fresh.metrics;
                    existing.available_services = fresh.available_services;
                    existing.available_locations = fresh.available_locations;
                    existing.available_sources = fresh.available_sources;
                    // effective_quantity is computed by the backend's
                    // top-down propagation walk: root_eff is target_qty *
                    // (1 + buffer), and each child's demand is
                    // parent_eff * input_ratio (where input_ratio bakes
                    // in the parent's NMC and DR). The backend re-runs
                    // this walk on every /calculate call, so its result
                    // is always fresh. The full re-render path
                    // (`this.treeNodes = result.nodes`) picks it up
                    // automatically; the preserveUI overlay path
                    // historically did NOT — leaving stale eff values
                    // on every existing node after Reset, Import Gear,
                    // post-optimize polling, location/service change,
                    // and any other interaction that round-trips
                    // through this code path. Symptom: child nodes
                    // showed eff = parent_eff * req_amount (the bare-
                    // stats fallback when NMC=DR=0) even after the
                    // optimizer produced real DR/NMC; e.g. the user's
                    // 3000-sickle 5%-buffer tree showed 3150 of every
                    // material instead of ~1729 (NMC=21%, DR=44%
                    // would predict 3150 * 0.5486 = 1728). Bug reports
                    // e9c05908 + af326247 (2026-05-19).
                    //
                    // Also overlay leaf_materials + best_pick_computed
                    // which the recompute pass also refreshes (they
                    // depend on the chosen source and live alongside
                    // effective_quantity in the calculate_tree
                    // response).
                    existing.effective_quantity = fresh.effective_quantity;
                    if (fresh.leaf_materials !== undefined) {
                        existing.leaf_materials = fresh.leaf_materials;
                    }
                    if (fresh.best_pick_computed !== undefined) {
                        existing.best_pick_computed = fresh.best_pick_computed;
                    }
                    // Overlay gear_config too — the per-node optimizer
                    // re-runs on locked_slots changes (slot popup commits)
                    // and produces a NEW optimized_export + new
                    // slot_alternatives. Without this overlay, the
                    // preserveUI path silently dropped the recalc'd
                    // gearset and the lock seemed to take effect only
                    // after a full page-hide/show cycle.
                    if (fresh.gear_config) {
                        existing.gear_config = {
                            ...(existing.gear_config || {}),
                            ...fresh.gear_config,
                        };
                    }
                    // Surgical update for the yellow ⚠️ lock-conflict
                    // badge in the card header. Lives next to .tree-node-
                    // name and is toggled on the live DOM here so the
                    // recompute pass in calculate_tree (server-side
                    // _check_locked_gearset_conflicts) is reflected
                    // immediately, without re-rendering the card. Card
                    // re-render was deliberately suppressed in the
                    // preserveUI path to keep the slot popup alive.
                    try {
                        const newWarn = fresh.gear_config && fresh.gear_config.lock_warning;
                        const $cardEl = this.$element
                            .find(`.tree-node-card[data-node-id="${existing.node_id}"]`).first();
                        if ($cardEl.length) {
                            // The warning box now lives at the top of
                            // the node body (below the header containing
                            // the name) — see the render-time block in
                            // tree-node-card.js. Surgically add/remove
                            // it here so lock changes via the slot
                            // popup update the box in place without
                            // tearing down the popup.
                            const $body = $cardEl.children('.tree-node-body').first();
                            const $existingBox = $cardEl.find('.tree-node-lock-warning-box').first();
                            if (newWarn) {
                                const detail = String(newWarn)
                                    .replace(/^Locked gear missing keyword:\s*/i, '')
                                    .replace(/</g, '&lt;');
                                const html = `<div class="tree-node-lock-warning-box" role="alert">
                                    <span class="lock-warning-icon" aria-hidden="true">
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M 13.5 3.2 L 21.5 19.3 Q 23 22 20 22 L 4 22 Q 1 22 2.5 19.3 L 10.5 3.2 Q 12 0.5 13.5 3.2 Z" fill="#4a3a08" stroke="#facc15" stroke-width="2" stroke-linejoin="round"/>
                                            <rect x="10.5" y="8" width="3" height="7" rx="1.5" fill="#facc15"/>
                                            <rect x="10.5" y="16" width="3" height="3" rx="1.5" fill="#facc15"/>
                                        </svg>
                                    </span>
                                    <div class="lock-warning-text">
                                        <span class="lock-warning-header">Requirements not met</span>
                                        <span class="lock-warning-detail">${detail}</span>
                                    </div>
                                </div>`;
                                if ($existingBox.length) {
                                    $existingBox.find('.lock-warning-detail').html(detail);
                                } else if ($body.length) {
                                    $body.prepend(html);
                                }
                            } else if ($existingBox.length) {
                                $existingBox.remove();
                            }
                        }
                    } catch (err) {
                        console.warn('[ct] lock-warning surgical update failed:', err);
                    }
                    // Surgical update: rebuild .tree-node-stats DOM
                    // (the WE/DA/DR/NMC/QO/FMF/Steps row) from the
                    // freshly-aggregated stats. Without this, picking
                    // a tool / consumable / pet via the popup left
                    // the displayed % values unchanged because
                    // _calculateOnly only mutated node.metrics in
                    // memory — the card's HTML was still the pre-
                    // lock render. User-reported: "added jerky and
                    // removed jerky and the DR stayed at 13.5%."
                    try {
                        const $cardEl2 = this.$element
                            .find(`.tree-node-card[data-node-id="${existing.node_id}"]`).first();
                        const $statsRow = $cardEl2.find('.tree-node-stats').first();
                        if ($statsRow.length) {
                            const stats = (fresh.metrics && fresh.metrics.stats_used) || {};
                            const isActivity = existing.source_type === 'activity'
                                || (existing.source_type === 'best' && existing.underlying_source_type === 'activity');
                            const isRecipe = existing.source_type === 'recipe'
                                || (existing.source_type === 'best' && existing.underlying_source_type === 'recipe');
                            const isEquipmentOutput = (existing.item_id || '').startsWith('Item.');
                            const pct = (v) => formatFixed(((v || 0) * 100), 2, { trim: true });
                            let html = ''
                                + `<span class="tree-node-stat"><img src="/assets/icons/attributes/work_efficiency.svg" class="tree-stat-icon" alt=""> WE: ${pct(stats.WE)}%</span>`
                                + `<span class="tree-node-stat"><img src="/assets/icons/attributes/double_action.svg" class="tree-stat-icon" alt=""> DA: ${pct(stats.DA)}%</span>`
                                + `<span class="tree-node-stat"><img src="/assets/icons/attributes/double_rewards.svg" class="tree-stat-icon" alt=""> DR: ${pct(stats.DR)}%</span>`;
                            if (isRecipe) {
                                html += `<span class="tree-node-stat"><img src="/assets/icons/attributes/no_materials_consumed.svg" class="tree-stat-icon" alt=""> NMC: ${pct(stats.NMC)}%</span>`;
                            }
                            if (isRecipe && isEquipmentOutput) {
                                html += `<span class="tree-node-stat"><img src="/assets/icons/attributes/quality_outcome.svg" class="tree-stat-icon" alt=""> QO: +${formatFixed((stats.quality_outcome || 0), 0)}</span>`;
                            }
                            if (isActivity) {
                                html += `<span class="tree-node-stat"><img src="/assets/icons/attributes/fine_material_finding.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> FMF: ${pct(stats.fine_material_finding)}%</span>`;
                            }
                            if (stats.flat) {
                                html += `<span class="tree-node-stat"><img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> Steps: ${stats.flat > 0 ? '+' : ''}${stats.flat}</span>`;
                            }
                            if (stats.pct) {
                                html += `<span class="tree-node-stat"><img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> Steps: ${pct(stats.pct)}%</span>`;
                            }
                            $statsRow.html(html);
                        }
                    } catch (err) {
                        console.warn('[ct] stats surgical update failed:', err);
                    }
                    mutatedCount++;
                }
                console.log('[LOC-FLICKER] _calculateOnly: mutated ' + mutatedCount + ' nodes in place');
                this.summary = result.summary || null;
                store.update('ui.crafting_tree.nodes', this.treeNodes);
                store.update('ui.crafting_tree.summary', this.summary);
                // NOTE: previously we iterated childComponents and called
                // child.render() on every TreeNodeCard so the gear preview
                // and metric spans reflected the recalc'd data. That was
                // destructive: re-rendering rebuilds the entire card HTML,
                // tears down nested gear-preview state (collapses it),
                // re-binds event handlers (occasionally leaving the
                // optimize button inert), and ripped the open
                // ItemSelectionPopup off-screen mid-edit. The user's spec
                // ('don't close the popup on lock') is incompatible with
                // the full re-render. The in-memory node objects are
                // mutated in place above, so the next user action that
                // does pass through render() (Optimize click, expand,
                // location change) will pick up the fresh data.
                // Recompute the displayed cumulative totals on the in-memory
                // nodes so the parent step counts reflect the locked-slot
                // recalc immediately, not just after a full _renderTree.
                if (typeof this._annotateDisplayedCumulative === 'function') {
                    try { this._annotateDisplayedCumulative(); } catch (_) { /* non-fatal */ }
                }
                // Push the freshly-computed stats.location back into every
                // live LocationDropdown so the button label updates when the
                // user picked "Best (auto)" and the backend resolved a new
                // best region. Without this, the dropdown's local
                // bestResolvedName stays null after clearSelection() and the
                // button keeps showing "Best (auto)" even after recalc.
                for (const child of this.childComponents) {
                    if (child && typeof child.syncAllLocationDropdowns === 'function') {
                        child.syncAllLocationDropdowns();
                    }
                }
                // Re-render ONLY the summary dashboard, not the whole tree.
                // Suppressed while any optimize is in flight — user spec:
                // "summary should stay, but only be updated on ALL CURRENT
                // OPTIMIZATIONS COMPLETING." The _calculateOnly call made
                // just before firing individual-node or all-node optimize
                // runs (via calculateAll) would otherwise refresh the
                // summary mid-flight with pre-optimization numbers. The
                // final _calculateOnly(preserveUI=true) inside
                // _pollOptimization runs AFTER _optimizingNodeIds is
                // cleared, so it still updates the summary with the
                // freshly-optimized numbers.
                const optimizeInFlight = !!this._isOptimizingAll
                    || !!(this._optimizingNodeIds && this._optimizingNodeIds.size > 0);
                const summaryContainer = this.$element.find('.crafting-tree-summary-container');
                if (this.summary && summaryContainer.length && !optimizeInFlight) {
                    // Destroy any existing summary child
                    this.childComponents = this.childComponents.filter(c => {
                        if (c && c.constructor && c.constructor.name === 'SummaryDashboard') {
                            c.destroy();
                            return false;
                        }
                        return true;
                    });
                    const SummaryDashboard = (await import('./crafting-tree-summary.js')).default;
                    const summaryDash = new SummaryDashboard(summaryContainer[0], {
                        summary: this.summary,
                    });
                    this.childComponents.push(summaryDash);
                    console.log('[LOC-FLICKER] _calculateOnly: summary dashboard rebuilt');
                }
                // Sync the per-node card step numbers to the SAME annotated
                // totals the summary just used. _calculateOnly deliberately
                // does not re-render the cards (to preserve an open popup /
                // gear-preview), so without this their step spans went stale
                // and the summary "Total steps" no longer matched the
                // component cards. Bug 5e9a6344.
                if (!optimizeInFlight) {
                    try { this._repopulateNodeMetrics(); }
                    catch (err) { console.warn('[ct] repopulate metrics failed:', err); }
                }
                this._syncSummaryRefreshVisibility();
                this._debounceSave();
            } else {
                console.log('[LOC-FLICKER] _calculateOnly: FULL RE-RENDER path taken (calling _renderTree)');
                this.treeNodes = result.nodes || this.treeNodes;
                this.summary = result.summary || null;
                store.update('ui.crafting_tree.nodes', this.treeNodes);
                store.update('ui.crafting_tree.summary', this.summary);
                this._renderTree();
                this._debounceSave();
            }
            console.log('[LOC-FLICKER] _calculateOnly finished');
        } catch (err) {
            api.showError('Failed to calculate crafting tree');
            console.error('[LOC-FLICKER] _calculateOnly error:', err);
        } finally {
            if (!suppressButtonReset) {
                const $btn = this.$element.find('.crafting-tree-calc-btn');
                $btn.removeClass('optimizing').prop('disabled', false)
                    .text('Calculate & Optimize All');
            }
        }
    }

    async onSourceChange(nodeId, newSource, opts = {}) {
        const sessionUuid = store.get('session.uuid');
        const isPreview = !!opts.preview_mode;
        const isChipRevert = !!opts._from_chip_revert;
        const chipKey = opts._chip_key || null;
        // For chip swap / revert we want the OLD children to slide up
        // at the SAME TIME as the NEW children slide down (user spec
        // 2026-05-15). The previous absolute-positioned-clone approach
        // never animated cleanly because cloned descendants can carry
        // their own positioning that doesn't collapse with a height
        // animation. Instead, DETACH the old children from inside the
        // parent card and re-insert them as a sibling RIGHT AFTER the
        // parent's outer wrapper (oldCard.$element). Sibling lives in
        // normal flow so jQuery slideUp() collapses height + padding
        // + margin together for a clean animation. Survives the
        // upcoming partial render because parentCard.render() does
        // this.$element.html(...) which only touches $element's
        // CONTENT, not its siblings.
        let $detachedOldChildren = null;
        if (isPreview || isChipRevert) {
            const oldCard = this._findTreeNodeCard(nodeId);
            if (oldCard) {
                const $oldChildren = oldCard.$element
                    .find('.tree-node-card[data-node-id="' + nodeId + '"]').first()
                    .children('.tree-node-children').first();
                if ($oldChildren.length && $oldChildren.children().length) {
                    $detachedOldChildren = $oldChildren.detach();
                    oldCard.$element.after($detachedOldChildren);
                    if (window._craftingTreeDebugRender) {
                        console.log('[CT-RENDER] onSourceChange.oldChildrenDetached', {
                            nodeId, childCount: $detachedOldChildren.children().length,
                        });
                    }
                }
            }
        }
        try {
            // Capture the parent node BEFORE the backend rebuild so
            // we can re-attach the Material-Options preview state
            // (chip selection + per-child preview flag + recipe-name
            // commit-link label) afterward. Backend rebuild replaces
            // the tree with a fresh subtree under nodeId; preview
            // markers are pure frontend state and would be lost
            // otherwise.
            // Compute the recipe_label for the commit link by looking
            // up the chip's leaf_materials option on the parent
            // before the rebuild — the parent's leaf_materials still
            // reflect the OLD source, which is fine since the chip
            // metadata is keyed off (source_id, mgi).
            let recipeLabelForChild = null;
            if (isPreview && chipKey) {
                const oldParent = this.treeNodes.find(n => n.node_id === nodeId);
                if (oldParent) {
                    const opt = (oldParent.leaf_materials || []).find(o => {
                        const sid = String(o.source_id || '');
                        const mgi = o.material_group_index == null ? 0 : o.material_group_index;
                        return `${sid}::${mgi}` === chipKey;
                    });
                    if (opt) {
                        recipeLabelForChild = opt.recipe_label || opt.label || null;
                    }
                }
            }

            if (window._craftingTreeDebugRender) {
                console.log('[CT-RENDER] onSourceChange.backendCallStart', {
                    nodeId, sourceType: newSource && newSource.type,
                    sourceId: newSource && newSource.source_id,
                    mgi: newSource && newSource.material_group_index,
                    isPreview, isChipRevert, chipKey,
                });
            }
            const backendStart = performance.now();
            const result = await api.craftingTreeSourceChange(
                this.treeNodes, nodeId, newSource, sessionUuid,
                this.globalSettings.spoiler_protection
            );
            this.treeNodes = result.nodes || this.treeNodes;
            const mgi = opts.material_group_index;
            if (mgi != null && mgi >= 0) {
                const result2 = await api.craftingTreeMaterialGroupChange(
                    this.treeNodes, nodeId, mgi, sessionUuid,
                    this.globalSettings.spoiler_protection,
                    this.globalSettings,
                );
                this.treeNodes = result2.nodes || this.treeNodes;
            }
            if (window._craftingTreeDebugRender) {
                console.log('[CT-RENDER] onSourceChange.backendDone', {
                    nodeId, durationMs: formatFixed((performance.now() - backendStart), 1),
                });
            }

            const target = this.treeNodes.find(n => n.node_id === nodeId);
            if (target) {
                if (isPreview && chipKey) {
                    // Preview path: the parent keeps the chip-selection
                    // marker (so chips stay visible + the right one is
                    // highlighted), and every immediate child gets a
                    // preview marker + recipe-name link label so the
                    // (preview) tag and the commit link render on each
                    // child instead of on the parent.
                    target._mo_preview_chip = chipKey;
                    const immediateChildren = this.treeNodes.filter(n => n.parent_id === nodeId);
                    immediateChildren.forEach(child => {
                        child._mo_preview_chip = chipKey;
                        if (recipeLabelForChild) {
                            child._mo_parent_recipe_label = recipeLabelForChild;
                        }
                    });
                } else {
                    // Non-preview path (revert via Best chip click,
                    // source dropdown manual pick, etc.) — the
                    // preview flow is over. Clear all preview markers
                    // anywhere in the tree so leftover state from a
                    // previous chip click doesn't render stale
                    // (preview) tags.
                    delete target._mo_preview_chip;
                    delete target._mo_parent_recipe_label;
                    this.treeNodes.forEach(n => {
                        delete n._mo_preview_chip;
                        delete n._mo_parent_recipe_label;
                    });
                }
            }

            store.update('ui.crafting_tree.nodes', this.treeNodes);
            // Surgical render path for chip preview AND revert: only
            // re-render the parent TreeNodeCard (which destroys +
            // rebuilds its descendants) instead of nuking the whole
            // tree via _renderTree(). This avoids the full-page flash
            // the user reported. The overview re-renders via a
            // separate cheap path so the Material Options block there
            // stays in sync.
            const useSurgical = isPreview || isChipRevert;
            const parentCard = useSurgical ? this._findTreeNodeCard(nodeId) : null;
            if (parentCard) {
                if (window._craftingTreeDebugRender) {
                    console.log('[CT-RENDER] onSourceChange.partialRenderStart', {
                        nodeId, isPreview, isChipRevert,
                    });
                }
                parentCard.props.node = target;
                parentCard.props.allNodes = this.treeNodes;
                parentCard.render();
                // Find the new children container and hide it for
                // the slideDown. We do this BEFORE kicking off either
                // animation so both can start in the same tick.
                let $newChildren = null;
                if (isPreview) {
                    $newChildren = parentCard.$element
                        .find('.tree-node-card[data-node-id="' + nodeId + '"]').first()
                        .children('.tree-node-children').first();
                    if ($newChildren.length && $newChildren.children().length) {
                        $newChildren.hide();
                    } else {
                        $newChildren = null;
                    }
                }
                // Animation duration — both old slideUp and new
                // slideDown use the SAME value so they finish at the
                // same instant.
                const animMs = 220;
                if ($detachedOldChildren) {
                    // jQuery slideUp animates height + padding-top +
                    // padding-bottom + margin-top + margin-bottom to 0
                    // and then sets display:none. The detached element
                    // is in normal flow (sibling of parent card), so
                    // the collapse looks natural. Removed from the
                    // DOM in the completion callback.
                    $detachedOldChildren.slideUp(animMs, function () {
                        $detachedOldChildren.remove();
                    });
                }
                if ($newChildren) {
                    $newChildren.slideDown(animMs);
                }
                // Keep the tree overview in sync with the new preview
                // state — re-render only it (cheap; just a flat list).
                const overviewComp = (this.childComponents || []).find(c => c && c.constructor && c.constructor.name === 'TreeOverview');
                if (overviewComp) {
                    overviewComp.props.nodes = this.treeNodes;
                    overviewComp.render();
                    overviewComp.attachEvents();
                }
                if (window._craftingTreeDebugRender) {
                    console.log('[CT-RENDER] onSourceChange.partialRenderDone', { nodeId, animMs });
                }
            } else {
                if (window._craftingTreeDebugRender) {
                    console.log('[CT-RENDER] onSourceChange.fullRenderTreeStart', {
                        nodeId, reason: useSurgical ? 'no-parent-card-found' : 'non-preview',
                    });
                }
                // If we pinned an old clone but went down the full
                // If we detached old children but went down the full
                // render path (defensive — shouldn't happen normally),
                // still play the slideUp so the user sees a graceful
                // collapse rather than a snap-removal.
                if ($detachedOldChildren) {
                    $detachedOldChildren.slideUp(220, function () {
                        $detachedOldChildren.remove();
                    });
                }
                this._renderTree();
                // User spec 2026-05-15/16: source-change manual pick from
                // the source dropdown (non-preview, non-revert) clears the
                // node's metrics in on_source_change but never recomputes
                // them — _renderTree just paints the cleared state.
                // Result: stats DISAPPEAR from the parent + its descendants
                // until the user clicks Calculate again. Fix: trigger a
                // background _calculateOnly so the freshly-built subtree
                // gets metrics + decoded gear stats applied immediately.
                // suppressButtonReset=true because there's no Calculate
                // button spinning to reset; preserveUI=false because we
                // already did a full _renderTree().
                if (!isPreview && !isChipRevert) {
                    this._calculateOnly(true, false).catch(err => {
                        console.warn('[ct] post-source-change recalc failed:', err);
                    });
                }
            }
            this._debounceSave();
        } catch (err) {
            // Clean up the floating old-children clone if we threw
            // anywhere mid-flight, so it doesn't get stranded on the
            // page.
            if ($detachedOldChildren) { try { $detachedOldChildren.remove(); } catch (_) { /* noop */ } }
            api.showError('Failed to change source');
        }
    }

    /**
     * Material Options commit — fired from the recipe-name link that
     * appears next to the (preview) tag on a preview child. Source
     * already reflects the chosen recipe + material group (the chip
     * click previously called the backend with preview_mode=true), so
     * "commit" just clears the preview markers on the child and its
     * descendants. The parent's chips disappear because the parent's
     * source is no longer Best (the chip-show condition fails).
     */
    onMaterialPreviewCommit(childNodeId) {
        const child = this.treeNodes.find(n => n.node_id === childNodeId);
        if (!child) return;
        // Clear preview markers on the parent of this child + all
        // descendants of the parent (the whole previewed subtree).
        const parent = this.treeNodes.find(n => n.node_id === child.parent_id);
        if (parent) {
            delete parent._mo_preview_chip;
        }
        // Walk the subtree under the parent (or under this child if
        // somehow there's no parent) and clear preview markers.
        const rootId = parent ? parent.node_id : childNodeId;
        const stack = [rootId];
        const visited = new Set();
        while (stack.length) {
            const id = stack.pop();
            if (visited.has(id)) continue;
            visited.add(id);
            const n = this.treeNodes.find(x => x.node_id === id);
            if (!n) continue;
            delete n._mo_preview_chip;
            delete n._mo_parent_recipe_label;
            this.treeNodes
                .filter(x => x.parent_id === id)
                .forEach(c => stack.push(c.node_id));
        }
        store.update('ui.crafting_tree.nodes', this.treeNodes);
        // Partial render the parent card (which rebuilds its
        // descendants) — preview markers are gone so the (preview)
        // tags + commit links don't render anymore. Source dropdown
        // on the parent now shows the actual committed recipe (no
        // longer overridden to "Best (auto)").
        const targetCard = parent ? this._findTreeNodeCard(parent.node_id) : null;
        if (targetCard) {
            targetCard.props.node = parent;
            targetCard.props.allNodes = this.treeNodes;
            targetCard.render();
            const overviewComp = (this.childComponents || []).find(c => c && c.constructor && c.constructor.name === 'TreeOverview');
            if (overviewComp) {
                overviewComp.props.nodes = this.treeNodes;
                overviewComp.render();
                overviewComp.attachEvents();
            }
        } else {
            this._renderTree();
        }
        this._debounceSave();
    }

    async onMaterialGroupChange(nodeId, groupIndex) {
        const sessionUuid = store.get('session.uuid');
        try {
            const result = await api.craftingTreeMaterialGroupChange(
                this.treeNodes, nodeId, groupIndex, sessionUuid,
                this.globalSettings.spoiler_protection,
                this.globalSettings,
            );
            this.treeNodes = result.nodes || this.treeNodes;
            store.update('ui.crafting_tree.nodes', this.treeNodes);
            this._renderTree();
            this._debounceSave();
        } catch (err) {
            api.showError('Failed to change material group');
        }
    }

    onBankQtyChange(nodeId, qty) {
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (node) {
            node.banked_quantity = qty;
            this._debounceSave();
        }
    }

    onGlobalSettingsChange(settings) {
        // Invalidate every card's displayed metrics when any setting that
        // fundamentally changes the tree's math changes. target_quality
        // drives quality_prob + steps/Quality+ labeling, target_quantity
        // scales effective_quantity through the whole tree, and
        // buffer_percentage pads required-amount math at every node. Any
        // of these going stale means the numbers on screen no longer
        // match the user's intent, so we blank the metric spans on every
        // tree node + the summary dashboard. User re-runs
        // 'Calculate & Optimize All' to refresh — no auto-recalc here,
        // per explicit request: invalidate the whole tree on change.
        const INVALIDATING_KEYS = ['target_quality', 'target_quantity', 'buffer_percentage'];
        const prev = this.globalSettings || {};
        const changedInvalidating = INVALIDATING_KEYS.some(k => prev[k] !== settings[k]);
        this.globalSettings = settings;
        if (changedInvalidating) {
            this._invalidateTreeMetrics();
        }
        this._debounceSave();
    }

    /**
     * Blank the metric spans on every tree-node-card, every
     * tree-overview-node row, and the summary dashboard. Used when one
     * of the INVALIDATING_KEYS in global settings changes — signals to
     * the user that the currently-displayed numbers are stale and they
     * must re-run Calculate & Optimize All. Does NOT mutate
     * node.metrics — just the DOM — so the data is still intact on the
     * node objects until the next calculate pass overwrites it.
     */
    _invalidateTreeMetrics() {
        // Per-node card spans. Reuses the existing helper that already
        // covers header 'steps/item' + body 'total steps' / 'total
        // actions' / 'total steps per item' + overview row.
        for (const n of (this.treeNodes || [])) {
            if (n && n.node_id) {
                try {
                    this._clearNodeMetrics(n.node_id);
                } catch (err) {
                    console.warn('[ct-invalidate] clear failed for', n.node_id, err);
                }
            }
        }
        // Summary dashboard — wipe the rendered card by replacing the
        // inner container with a simple stale-notice block. The next
        // _calculateOnly call will re-render it via SummaryDashboard as
        // usual (it re-reads this.summary which stays cached).
        const $summary = this.$element.find('.crafting-tree-summary-container');
        if ($summary.length) {
            // Destroy the live SummaryDashboard component so its
            // internal state doesn't fight the placeholder we're about
            // to inject.
            this.childComponents = (this.childComponents || []).filter(c => {
                if (c && c.constructor && c.constructor.name === 'SummaryDashboard') {
                    try { c.destroy(); } catch (_) {}
                    return false;
                }
                return true;
            });
            $summary.html(
                '<div class="tree-summary-card tree-summary-card--stale">'
                + '<div class="tree-summary-header">📊 Summary</div>'
                + '<p class="tree-summary-empty">Settings changed — click <strong>Calculate &amp; Optimize All</strong> to refresh.</p>'
                + '</div>'
            );
        }
    }

    /**
     * Walk childComponents (recursively across nested TreeNodeCard
     * instances) to find the TreeNodeCard whose props.node.node_id
     * matches `nodeId`. Used by partial-render paths so we can
     * surgically re-render a single subtree instead of nuking the
     * whole tree via _renderTree(). Returns null if not found.
     */
    _findTreeNodeCard(nodeId) {
        const search = (components) => {
            for (const c of (components || [])) {
                if (!c) continue;
                if (c.props && c.props.node && c.props.node.node_id === nodeId) {
                    return c;
                }
                if (c.childComponents) {
                    const found = search(c.childComponents);
                    if (found) return found;
                }
            }
            return null;
        };
        return search(this.childComponents);
    }

    scrollToNode(nodeId) {
        // Target the tree node card, not the overview minimap node
        const el = this.$element.find(`.tree-node-card[data-node-id="${nodeId}"]`).first();
        if (el.length) {
            // Expand any collapsed ancestor cards so the node is actually
            // visible when we scroll to it. Walk up the card chain, marking
            // every ancestor card's body/options/children visible and
            // clearing node.collapsed / node.children_hidden on the saved
            // tree state.
            const allNodes = this.treeNodes || [];
            el.parents('.tree-node-card').addBack().each(function () {
                const $card = $(this);
                const nid = $card.data('node-id');
                $card.children('.tree-node-body').show();
                $card.children('.tree-node-material-options').show();
                $card.children('.tree-node-children').show();
                const $header = $card.children('.tree-node-header');
                $header.removeClass('collapsed');
                $header.find('.tree-node-header-arrow').addClass('expanded');
                const $btn = $card.find('> .tree-node-body > .tree-node-children-toggle');
                $btn.removeClass('collapsed').addClass('expanded');
                $btn.find('.expand-arrow').addClass('expanded');
                $btn.find('.tree-node-toggle-text').text('Hide children');
                const n = allNodes.find(nn => nn.node_id === nid);
                if (n) {
                    n.collapsed = false;
                    n.children_hidden = false;
                }
            });
            el[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.addClass('tree-node-highlight');
            setTimeout(() => el.removeClass('tree-node-highlight'), 1500);
            this._debounceSave && this._debounceSave();
        }
    }

    _renderPalettePopover() {
        const settings = store.get('ui.crafting_tree.global_settings') || {};
        const palette = settings.line_colors || DEFAULT_PALETTE;
        const customColors = settings.custom_colors || LINE_COLOR_PALETTES['Custom'];

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

        const $pop = this.$element.find('.ct-palette-popover');
        $pop.html(`
            <div class="ct-palette-popover-inner">
                <div class="ct-palette-popover-title">Section theme colors</div>
                <div class="ct-palette-list">${paletteRowsHtml}</div>
                <div class="ct-custom-colors ${palette === 'Custom' ? '' : 'ct-hidden'}">
                    <div class="ct-custom-colors-row">${customInputsHtml}</div>
                </div>
            </div>
        `);

        // Wire events inside the popover
        const self = this;
        $pop.off('click.palette input.palette');
        $pop.on('click.palette', '.ct-palette-row', function () {
            const name = $(this).data('palette');
            $pop.find('.ct-palette-row').removeClass('ct-palette-selected').find('.ct-palette-check').remove();
            $(this).addClass('ct-palette-selected').append('<span class="ct-palette-check">✓</span>');
            if (name === 'Custom') {
                $pop.find('.ct-custom-colors').removeClass('ct-hidden');
            } else {
                $pop.find('.ct-custom-colors').addClass('ct-hidden');
            }
            self._savePaletteFromPopover($pop);
        });
        $pop.on('input.palette', '.ct-custom-color', (e) => {
            const idx = $(e.target).data('index');
            const color = $(e.target).val();
            // Update the dot in the Custom palette row
            $pop.find(`.ct-palette-row[data-palette="Custom"] .ct-palette-dots .ct-palette-dot:nth-child(${idx + 1})`).css('background', color);
            self._savePaletteFromPopover($pop);
        });
    }

    _savePaletteFromPopover($pop) {
        const palette = $pop.find('.ct-palette-row.ct-palette-selected').data('palette') || DEFAULT_PALETTE;
        const customColors = [];
        $pop.find('.ct-custom-color').each(function () { customColors.push($(this).val()); });
        const existing = store.get('ui.crafting_tree.global_settings') || {};
        const updated = {
            ...existing,
            line_colors: palette,
            custom_colors: customColors.length === 8 ? customColors : LINE_COLOR_PALETTES['Custom'],
        };
        store.update('ui.crafting_tree.global_settings', updated);
        this.globalSettings = updated;
        _applyCraftingTreeColors(updated);
    }

    async _renderPresetDropdown() {
        const sessionUuid = store.get('session.uuid');
        const $dd = this.$element.find('.crafting-tree-preset-dropdown');
        try {
            this._savedPresets = await api.listSavedCraftingTrees(sessionUuid);
        } catch (err) {
            this._savedPresets = [];
        }
        $dd.html(`
            <input type="text" class="crafting-tree-preset-search" placeholder="Search..." value="${this._presetSearchText}" />
            <div class="crafting-tree-preset-list">
                <div class="crafting-tree-preset-new crafting-tree-preset-item-row">+ New Goal</div>
                ${this._renderPresetListItems()}
            </div>
        `);
    }

    _renderPresetListItems() {
        const presets = this._savedPresets || [];
        const search = (this._presetSearchText || '').toLowerCase();
        const filtered = presets.filter(p => p.name.toLowerCase().includes(search));
        if (!filtered.length) return '<div class="crafting-tree-preset-empty">No saved goals</div>';
        return filtered.map(p => {
            const isPending = this._presetPendingDelete === p.id;
            const delClass = isPending ? 'crafting-tree-preset-delete confirm' : 'crafting-tree-preset-delete';
            const delText = isPending ? 'Delete?' : '×';
            const selectedClass = p.id === this._currentPresetId ? 'selected' : '';
            return `<div class="crafting-tree-preset-item ${selectedClass}" data-tree-id="${p.id}">
                <span>${p.name}</span>
                <button class="${delClass}" data-tree-id="${p.id}">${delText}</button>
            </div>`;
        }).join('');
    }

    _renderPresetList() {
        const $list = this.$element.find('.crafting-tree-preset-list');
        if ($list.length) {
            const newBtn = '<div class="crafting-tree-preset-new crafting-tree-preset-item-row">+ New Goal</div>';
            $list.html(newBtn + this._renderPresetListItems());
        }
    }

    _renderTree() {
        console.log('[LOC-FLICKER] _renderTree ENTERED (full rebuild of all cards)');
        console.trace('[LOC-FLICKER] _renderTree call stack');
        if (window._craftingTreeDebugRender) {
            this._renderCounter = (this._renderCounter || 0) + 1;
            console.log('[CT-RENDER] _renderTree FULL rebuild #' + this._renderCounter, {
                rootItem: (this.treeNodes.find(n => !n.parent_id) || {}).item_name,
                nodeCount: this.treeNodes.length,
                ts: formatFixed(performance.now(), 1),
            });
        }
        // Destroy old child components
        this.childComponents.forEach(c => c.destroy());
        this.childComponents = [];

        // Annotate each node with its displayed cumulative totals
        // (ceiled-self-steps summed across the subtree). This is what
        // makes the cards and summary arithmetically reconcile: the
        // twine root's per-item becomes ceil(twine_self) + ceil(flax_self)
        // = 42 + 165 = 207, and the summary total matches. Bug 3cead1f0
        // (2026-05-09) — user expected card totals to sum to the summary.
        this._annotateDisplayedCumulative();

        // Item selector
        this._renderItemSelector();

        // Settings panel
        const settingsContainer = this.$element.find('.crafting-tree-settings-container');
        const settingsPanel = new GlobalSettingsPanel(settingsContainer[0], {
            onChange: (s) => this.onGlobalSettingsChange(s),
            isEquipment: this._isTargetEquipment(),
        });
        this.childComponents.push(settingsPanel);

        // Overview minimap
        const overviewContainer = this.$element.find('.crafting-tree-overview-container');
        const overview = new TreeOverview(overviewContainer[0], {
            nodes: this.treeNodes,
            onNodeClick: (nodeId) => this.scrollToNode(nodeId),
            // Material options header click in the overview — scroll
            // to the parent card's chip area without activating any
            // preview.
            onMaterialOptionsHeaderClick: (nodeId) => this.scrollToNode(nodeId),
            // Material option click in the overview — scroll to the
            // parent card AND fire the same chip-click flow as
            // clicking the chip directly on the card. Looks up the
            // matching available_sources entry by (source_id, mgi)
            // and calls onSourceChange with preview_mode=true so the
            // backend rebuilds the parent's subtree with the chosen
            // recipe + group.
            onMaterialOptionPreview: (nodeId, chipKey) => {
                this.scrollToNode(nodeId);
                const node = this.treeNodes.find(n => n.node_id === nodeId);
                if (!node) return;
                const [srcId, mgiStr] = String(chipKey).split('::');
                const mgi = (mgiStr === '' || mgiStr == null) ? null : parseInt(mgiStr, 10);
                if (node._mo_preview_chip === chipKey) {
                    // Active chip → revert to Best
                    const bestSource = (node.available_sources || []).find(s => s && s.type === 'best');
                    if (bestSource) {
                        this.onSourceChange(nodeId, bestSource, { preview_mode: false, _from_chip_revert: true });
                    }
                    return;
                }
                const source = (node.available_sources || []).find(s => {
                    if (!s || s.type !== 'recipe') return false;
                    if (String(s.source_id || '') !== srcId) return false;
                    if (s.material_group_index != null && mgi != null) {
                        if (s.material_group_index !== mgi) return false;
                    }
                    return true;
                });
                if (!source) return;
                const opts = { preview_mode: true, _chip_key: chipKey };
                if (mgi != null) opts.material_group_index = mgi;
                this.onSourceChange(nodeId, source, opts);
            },
            optimizationStatus: this.optimizationStatus,
        });
        this.childComponents.push(overview);

        // Holistic Mode details toggle — only rendered when the LP solver
        // actually ran (lp_mode ∈ {on, fallback}). Hidden otherwise so
        // users without the FAC flag never see it. Default OFF; keeps the
        // backend LP math active but hides the verbose badge + per-node
        // insight strips. Engineers can still capture everything via the
        // [CT-LP-NODE] console logs for debugging regardless of this flag.
        this._renderLpToggle();

        // Tree nodes
        const nodesContainer = this.$element.find('.crafting-tree-nodes-container');
        nodesContainer.empty();

        // Apply depth line colors via shared <style> tag (live-updatable)
        console.log('[ct-theme] _renderTree apply colors', {
            line_colors: this.globalSettings?.line_colors,
            custom_colors_len: (this.globalSettings?.custom_colors || []).length,
        });
        _applyCraftingTreeColors(this.globalSettings);
        const root = this.treeNodes.find(n => !n.parent_id);
        if (root) {
            const rootDiv = $('<div class="tree-node-root-container"></div>');
            nodesContainer.append(rootDiv);
            const rootCard = new TreeNodeCard(rootDiv[0], {
                node: root,
                depth: 0,
                allNodes: this.treeNodes,
                globalSettings: this.globalSettings,
                onSourceChange: (nid, src, opts) => this.onSourceChange(nid, src, opts),
                onOptimize: (nid) => this._optimizeNode(nid),
                onBankQtyChange: (nid, qty) => this.onBankQtyChange(nid, qty),
                onAlternativeSelect: (nid, idx) => this._selectAlternative(nid, idx),
                onMaterialGroupChange: (nid, idx) => this.onMaterialGroupChange(nid, idx),
                // Material Options chip preview commit (clicked the
                // recipe-name link next to "(preview)" on a child).
                // Clears preview markers on the parent + all
                // descendants — source is already the chosen recipe.
                onMaterialPreviewCommit: (nid) => this.onMaterialPreviewCommit(nid),
                onRecalculate: (opts) => this._calculateOnly(false, !!(opts && opts.preserveUI)),
                onEquip: (nid) => this._equipNodeGearset(nid),
                onNavigateToNode: (nid) => this.scrollToNode(nid),
                // Fired from the tree-node slot popup when the user picks
                // an item or toggles a lock. payload = {type, slot,
                // slotItem|itemId, locked, lockedSlots}. Commits the
                // lockedSlots map to the node, then triggers a recalc
                // with preserveUI so DOM updates in place (no flicker).
                // Backend honors locked_slots as a hard constraint and
                // step counts propagate up via _annotateDisplayedCumulative.
                onTreeNodeSlotChange: (nid, slot, payload) => this._onTreeNodeSlotChange(nid, slot, payload),
                // Fired from the import-gearset button on a per-node
                // card. The card has already mutated gear_config.
                // optimized_export with the new export string, cleared
                // optimized_stats, and populated locked_slots so the
                // optimizer respects the imported items on next run.
                // We use preserveUI:false here (full _renderTree) — the
                // import path needs the slot tiles to re-render so the
                // newly-populated locked_slots show their orange lock
                // badges. The preserveUI=true path that the slot-popup
                // path uses skips card re-render to keep the popup
                // alive, but no popup is open during an import, so a
                // full rebuild is safe and gets us correct UI in one
                // shot. Without this, the import succeeded and the
                // gearset applied, but the lock badges wouldn't appear
                // until the next page navigation. Bug 233c9cd0
                // follow-up: "if you import a GS it should lock every
                // slot that imports."
                onImport: (nid) => {
                    // Bonez565 bug 424b34f7 (2026-05-17): "Gear import feels
                    // really slow, sometimes running optimizer is faster".
                    // The previous flow used preserveUI:false here, which
                    // forced the entire tree to re-render from scratch
                    // (including every dropdown's subcomponent setup) just
                    // to show the imported gear on one node. The
                    // optimize-complete path solved the same problem more
                    // cheaply: preserveUI:true mutates node objects in place
                    // (so the dropdown components keep their state) and
                    // then we manually re-render each TreeNodeCard's DOM
                    // tree. card.render() rebuilds the gear preview tiles
                    // from gear_config and re-instantiates the
                    // Location/Service/RecipeSource dropdowns, so the
                    // dropdowns stay clickable AND the new gear shows up.
                    // Reuses the exact pattern from _pollOptimization
                    // (around line 2060) so any future improvements stay
                    // shared.
                    //
                    // _clearNodeMetrics blanks the displayed numbers
                    // immediately so the user sees instant feedback that
                    // their import landed, instead of staring at stale
                    // metrics until the backend round-trip resolves —
                    // same trick _optimizeNode uses on click.
                    this._clearNodeMetrics(nid);
                    this._debounceSave();
                    this._calculateOnly(/*suppressButtonReset*/ true, /*preserveUI*/ true)
                        .then(() => {
                            try { this._annotateDisplayedCumulative(); }
                            catch (err) { console.warn('[tree-import] _annotateDisplayedCumulative failed:', err); }
                            const rerenderAll = (comps) => {
                                for (const c of (comps || [])) {
                                    if (c && c.constructor
                                            && c.constructor.name === 'TreeNodeCard'
                                            && typeof c.render === 'function') {
                                        try { c.render(); }
                                        catch (err) { console.warn('[tree-import] card re-render failed:', err); }
                                    }
                                    if (c && c.childComponents) rerenderAll(c.childComponents);
                                }
                            };
                            rerenderAll(this.childComponents);
                            // Refresh the tree overview for the same reason
                            // the optimize-complete path does — keeps the
                            // mini-map in sync with new step counts.
                            const overviewComp = (this.childComponents || []).find(
                                c => c && c.constructor && c.constructor.name === 'TreeOverview'
                            );
                            if (overviewComp) {
                                overviewComp.props.nodes = this.treeNodes;
                                overviewComp.props.optimizationStatus = this.optimizationStatus;
                                overviewComp.render();
                                overviewComp.attachEvents();
                            }
                        })
                        .catch(err => console.warn('[tree-import] recalc failed', err));
                },
                // Fired from the input-item slot popup when the user
                // picks an input (e.g. arrows, plant, fabric) for an
                // activity that requires it. payload = {type:'pick',
                // item:{...}} or {type:'unlock'}. Stored on
                // node.gear_config.user_input_items so it overrides the
                // backend auto-pick on the next optimize. preserveUI
                // recalc updates the in-memory step counts; the input
                // slot tile re-renders via the surgical update below.
                onTreeNodeInputChange: (nid, idx, payload) => this._onTreeNodeInputChange(nid, idx, payload),
                // Fired when the user collapses or expands a node's
                // gear preview. Just persists to the saved tree state
                // so the open/closed flag survives reload + optimize.
                // The actual slide animation is driven by jQuery in
                // tree-node-card; this callback only triggers the
                // debounced backend save.
                onTreePreviewToggle: (nid, isOpen) => {
                    this._debounceSave();
                },
                // Reset button on each node — wipes the optimizer's
                // pick + every user pin (locked_slots, user_input_items,
                // selected_input_items, lock_warning). Lets the user
                // start over without manually unequipping each slot.
                onTreeNodeReset: (nid) => this._onTreeNodeReset(nid),
            });
            this.childComponents.push(rootCard);
        }

        // Summary
        const summaryContainer = this.$element.find('.crafting-tree-summary-container');
        if (this.summary) {
            const summaryDash = new SummaryDashboard(summaryContainer[0], {
                summary: this.summary,
            });
            this.childComponents.push(summaryDash);
        } else {
            summaryContainer.empty();
        }
        this._syncSummaryRefreshVisibility();
    }

    /**
     * Show/hide the manual "Rerun Summary" fallback button based on
     * whether a summary exists. Beta-only fallback for cases where the
     * auto-rebuild leaves stale numbers in the summary card.
     */
    _syncSummaryRefreshVisibility() {
        const $wrap = this.$element.find('.crafting-tree-summary-refresh-wrap');
        if (!$wrap.length) return;
        $wrap.toggle(!!this.summary);
    }

    /**
     * Compute displayed cumulative totals per node and stash on the
     * node object so TreeNodeCard + SummaryDashboard share one source
     * of truth. The goal: whatever numbers appear on the cards should
     * arithmetically sum to what the summary shows.
     *
     * Per node:
     *   _displayed_self_steps   = ceil(self_actions × eff) × steps_per_action
     *   _displayed_self_actions = ceil(self_actions × eff)
     *
     * Cumulative (post-order recursion over children):
     *   _displayed_cumulative_steps   = self + Σ child cumulative
     *   _displayed_cumulative_actions = self + Σ child cumulative
     *
     * Also stashes the root's cumulative onto this.summary so the
     * summary card reads it directly.
     */
    _annotateDisplayedCumulative() {
        if (!this.treeNodes || !this.treeNodes.length) return;
        const childrenOf = new Map();
        for (const n of this.treeNodes) {
            if (n.parent_id) {
                if (!childrenOf.has(n.parent_id)) childrenOf.set(n.parent_id, []);
                childrenOf.get(n.parent_id).push(n);
            }
        }
        // Bug 15110e01 — buffer at root only. The backend now cascades
        // children with target_quantity (whole-number demand) and the
        // root with effective_quantity = target × (1+buffer). To match,
        // the annotator:
        //   - For the ROOT node: multiplies self_steps × effective_quantity
        //     and DOES NOT ceil the action count (so "1.05 attempts"
        //     renders as 1.05, not ceil(1.05)=2 attempts of work).
        //   - For non-root nodes: integer effective_quantity from the
        //     backend cascade, ceil to next base_requirement_amount as
        //     before.
        // The previous summaryScale = target_qty/ceil(eff) band-aid is
        // gone — it over-corrected by halving the entire tree to undo
        // a root-only ceiling problem, which under-counted children's
        // contribution. With the per-node ceiling skipped at root, the
        // summary reads rootCum directly with no scaling.
        const computeSelf = (node, isRoot) => {
            const m = node.metrics || {};
            const selfSteps = (m.self_steps != null)
                ? m.self_steps
                : (m.total_steps != null ? m.total_steps : 0);
            const selfActions = (m.self_actions != null)
                ? m.self_actions
                : (m.total_actions != null ? m.total_actions : 0);
            const eff = (node.effective_quantity != null)
                ? node.effective_quantity
                : (node.base_requirement_amount || 1);
            if (selfSteps === Infinity) {
                return { steps: Infinity, actions: Infinity };
            }
            const rawSteps = selfSteps * eff;
            const rawActions = (selfActions || 0) * eff;
            if (rawActions === 0) {
                return { steps: 0, actions: 0 };
            }
            // Root: keep fractional. User spec: "Root row should be
            // fractional. Always."
            if (isRoot) {
                return { steps: rawSteps, actions: rawActions };
            }
            const spa = rawSteps / rawActions;
            const ceiledActions = Math.ceil(rawActions);
            const ceiledSteps = ceiledActions * spa;
            return { steps: ceiledSteps, actions: ceiledActions };
        };
        const visit = (node, isRoot) => {
            const self = computeSelf(node, isRoot);
            node._displayed_self_steps = self.steps;
            node._displayed_self_actions = self.actions;
            let cumSteps = self.steps;
            let cumActions = self.actions;
            const kids = childrenOf.get(node.node_id) || [];
            for (const k of kids) {
                const kidCum = visit(k, false);
                if (cumSteps === Infinity || kidCum.steps === Infinity) {
                    cumSteps = Infinity;
                } else {
                    cumSteps += kidCum.steps;
                }
                if (cumActions === Infinity || kidCum.actions === Infinity) {
                    cumActions = Infinity;
                } else {
                    cumActions += kidCum.actions;
                }
            }
            node._displayed_cumulative_steps = cumSteps;
            node._displayed_cumulative_actions = cumActions;
            return { steps: cumSteps, actions: cumActions };
        };
        const root = this.treeNodes.find(n => !n.parent_id);
        if (!root) return;
        const rootCum = visit(root, true);
        if (this.summary) {
            // No more summaryScale band-aid (bug 15110e01). The annotator
            // skips the per-node ceiling for the root, and the backend
            // cascades children with target_quantity, so the rootCum sum
            // already reflects "buffer at root only" semantics directly.
            this.summary.displayed_cumulative_steps = rootCum.steps;
            this.summary.displayed_cumulative_actions = rootCum.actions;
        }
    }

    _renderLpToggle() {
        // Holistic Mode toggle was retired 2026-05-15: LP is enabled
        // for ALL sessions and the totals always reflect LP-optimized
        // values, so the toggle had no useful purpose. We just clear
        // the container so any leftover DOM from a previous render is
        // removed; everything else continues to work because
        // window._craftingTreeShowHolisticDetails reads from
        // globalSettings.show_holistic_details (per-tree, default off).
        const $container = this.$element.find('.crafting-tree-lp-toggle-container');
        $container.empty();
        // Sync the new "Show holistic view details" checkbox under the
        // tree overview to the current persisted state. Re-running this
        // on every _renderTree() ensures the box matches the truth even
        // after a preset load swaps globalSettings out from under us.
        const $cb = this.$element.find('.ct-show-holistic-details');
        if ($cb.length) {
            $cb.prop('checked', !!window._craftingTreeShowHolisticDetails);
        }
        return;
    }

    /**
     * Re-render just the SummaryDashboard child component. Used by the
     * Holistic toggle so the total_steps/total_actions/etc swap between
     * LP-optimized and naive without rebuilding any TreeNodeCard.
     */
    _rerenderSummaryOnly() {
        const summaryContainer = this.$element.find('.crafting-tree-summary-container');
        if (!summaryContainer.length || !this.summary) return;
        // Drop the old summary child so its listeners/refs go away.
        const oldIdx = this.childComponents.findIndex(c =>
            c && c.$element && c.$element[0] === summaryContainer[0]);
        if (oldIdx >= 0) {
            try { this.childComponents[oldIdx].destroy && this.childComponents[oldIdx].destroy(); } catch (_) { /* ignore */ }
            this.childComponents.splice(oldIdx, 1);
        }
        const summaryDash = new SummaryDashboard(summaryContainer[0], {
            summary: this.summary,
        });
        this.childComponents.push(summaryDash);
        this._syncSummaryRefreshVisibility();
    }

    _renderItemSelector() {
        const targetId = store.get('ui.crafting_tree.target_item_id');
        // Skip rebuild if the target item hasn't changed and the selector
        // already exists. _renderTree() runs after every per-node mutation
        // (source change, material group pick, lock toggle, etc.) but the
        // recipe selector at the top only depends on the root target item.
        // Destroying + reimporting the dropdown each time caused a brief
        // height collapse → expand that bumped the scroll position
        // up-then-down. Bail early when nothing it depends on changed.
        if (this._recipeSelector && this._lastItemSelectorTargetId === targetId) {
            return;
        }
        this._lastItemSelectorTargetId = targetId;
        const root = this.treeNodes.find(n => !n.parent_id);
        const name = root ? root.item_name : '';
        const iconPath = root ? root.icon_path : '';
        const iconHtml = iconPath ? `<img src="${iconPath}" class="tree-item-icon" alt="" style="height:16px;width:16px;vertical-align:middle;margin-right:4px">` : '';
        const container = this.$element.find('.crafting-tree-item-select-container');
        container.html(`
            <div class="crafting-tree-recipe-selector-wrapper"></div>
        `);

        // Always render the recipe selector
        this._initRecipeSelector();
    }

    _initRecipeSelector() {
        // Memoize the in-flight init so callers (auto-open
        // setTimeout, manual taps, _renderItemSelector) await the
        // SAME completion promise instead of toggling a half-baked
        // picker. Bug 2940ca83: user picked a recipe but
        // selectRecipe was still the prototype (column3) method —
        // the override is the LAST step of init and the 100ms
        // auto-open setTimeout would fire toggleDropdown before
        // loadRecipes() resolved and render() had even put
        // .recipe-dropdown in the DOM. The user's tap landed on a
        // stale instance whose override hadn't been re-applied yet,
        // so loadTree() never fired and the tree stayed empty.
        if (this._recipeSelectorInitPromise) {
            return this._recipeSelectorInitPromise;
        }
        this._recipeSelectorInitPromise = this._doInitRecipeSelector()
            .finally(() => { this._recipeSelectorInitPromise = null; });
        return this._recipeSelectorInitPromise;
    }

    async _doInitRecipeSelector() {
        const self = this;
        const $wrapper = this.$element.find('.crafting-tree-recipe-selector-wrapper');
        if (!$wrapper.length) return;

        // Clean up previous
        if (this._recipeSelector) {
            this._recipeSelector.destroy();
            this._recipeSelector = null;
        }

        const { default: RecipeSelectorDropdown } = await import('./recipe-selector-dropdown.js');
        // decoupleColumn3: this is a STANDALONE target selector for the
        // crafting tree — it must not sync its label from column-3 state
        // (the main optimizer's recipe/activity selection). Bug 5e9a6344.
        this._recipeSelector = new RecipeSelectorDropdown($wrapper[0], { decoupleColumn3: true });
        await this._recipeSelector.loadRecipes();

        // Clear the selector to show "Select a recipe" — but if we have a loaded tree,
        // try to select the matching recipe
        const targetId = store.get('ui.crafting_tree.target_item_id');
        if (targetId && this._recipeSelector.recipesData) {
            // Find the recipe that outputs this item. The /api/recipes
            // payload is shaped { by_skill: { <skill>: [recipe,...] } }
            // (see RecipeSelectorDropdown.getSelectedRecipe), so we must
            // iterate .by_skill — iterating the top-level keys matched
            // nothing (matchId stayed null) and the label fell back to
            // the column-3 selection. Bug 5e9a6344.
            const allRecipes = this._recipeSelector.recipesData;
            const bySkill = (allRecipes && !Array.isArray(allRecipes) && allRecipes.by_skill)
                ? allRecipes.by_skill
                : allRecipes;
            let matchId = null;
            if (Array.isArray(bySkill)) {
                const match = bySkill.find(r => r.output_item === targetId);
                if (match) { matchId = match.id || match.name; }
            } else if (bySkill && typeof bySkill === 'object') {
                for (const skill of Object.keys(bySkill)) {
                    const match = (bySkill[skill] || []).find(r => r.output_item === targetId);
                    if (match) { matchId = match.id || match.name; break; }
                }
            }
            if (matchId) {
                this._recipeSelector.selectedRecipe = matchId;
            } else {
                this._recipeSelector.selectedRecipe = null;
            }
        } else {
            this._recipeSelector.selectedRecipe = null;
        }
        this._recipeSelector.render();

        // Override selectRecipe to load the crafting tree instead of updating Column 3
        this._recipeSelector.selectRecipe = (recipeId) => {
            console.log('[CT-PICKER] selectRecipe override fired', {
                recipeId,
                hasRecipesData: !!self._recipeSelector?.recipesData,
            });
            // Find the recipe from the loaded data
            const allRecipes = self._recipeSelector.recipesData || [];
            let outputItem = null;

            // recipesData is shaped { by_skill: { <skill>: [{ id, name,
            // output_item, ... }] } } (see getSelectedRecipe). Resolve via
            // .by_skill; iterating the top-level keys missed every recipe.
            // Bug 5e9a6344.
            const bySkill = (allRecipes && !Array.isArray(allRecipes) && allRecipes.by_skill)
                ? allRecipes.by_skill
                : allRecipes;
            if (Array.isArray(bySkill)) {
                const recipe = bySkill.find(r => (r.id || r.name) === recipeId);
                outputItem = recipe?.output_item;
            } else if (bySkill && typeof bySkill === 'object') {
                // Object grouped by skill
                for (const skill of Object.keys(bySkill)) {
                    const recipe = bySkill[skill]?.find(r => (r.id || r.name) === recipeId);
                    if (recipe) { outputItem = recipe.output_item; break; }
                }
            }

            // Close dropdown
            self._recipeSelector.isOpen = false;
            self._recipeSelector.render();

            if (outputItem) {
                store.update('ui.crafting_tree.target_item_id', null);
                store.update('ui.crafting_tree.nodes', null);
                self.loadTree(outputItem);
            } else {
                // Fallback: use recipeId as the item ref directly
                store.update('ui.crafting_tree.target_item_id', null);
                store.update('ui.crafting_tree.nodes', null);
                self.loadTree(recipeId);
            }
        };
    }

    async _showItemPicker() {
        // Wait for init to fully complete before toggling. The picker
        // is fragile: loadRecipes() XHR is async, render() runs after
        // that, and the selectRecipe override is the LAST step of
        // _doInitRecipeSelector. Toggling earlier opens a picker
        // whose .recipe-dropdown isn't in the DOM yet, and clicks
        // fall through to the column3 prototype handler instead of
        // the override — so loadTree() never fires (bug 2940ca83).
        if (this._recipeSelectorInitPromise) {
            await this._recipeSelectorInitPromise;
        } else if (!this._recipeSelector) {
            await this._initRecipeSelector();
        }
        if (this._recipeSelector) {
            this._recipeSelector.toggleDropdown();
        }
    }

    _isTargetEquipment() {
        const targetId = store.get('ui.crafting_tree.target_item_id') || '';
        return targetId.startsWith('Item.');
    }

    /**
     * Blank out the metric spans on a single tree-node-card while its
     * optimize is in flight. The header "X steps/item" and the body
     * "X total steps" / "X total actions" / "X total steps per item"
     * all read stale pre-optimization values otherwise. Keeps the
     * label suffix intact so the user can tell which row is which;
     * just swaps the numeric prefix for "—".
     *
     * Re-population happens on complete via the existing
     * rerenderAll(childComponents) loop in _pollOptimization, which
     * re-renders each TreeNodeCard from its (now fresh) node.metrics.
     */
    _clearNodeMetrics(nodeId) {
        const $card = this.$element.find(`.tree-node-card[data-node-id="${nodeId}"]`).first();
        if ($card.length) {
            // Header "X steps/item" (right-aligned green text in the title row)
            $card.children('.tree-node-header').find('.tree-node-steps').each(function () {
                const $span = $(this);
                const txt = $span.text();
                // Preserve everything from the first space onward (the unit
                // label like "steps/item"); only blank the numeric prefix.
                const m = txt.match(/\s(.+)$/);
                $span.text('— ' + (m ? m[1] : 'steps/item'));
            });
            // Body totals: first row shows "X total steps" + "X total actions",
            // second row (when present) shows "X total steps per item". Walk
            // each span and replace its leading number with "—". Drop the
            // 'tree-node-impossible' class if present — preserves Infinity-
            // style dimming between optimizes otherwise.
            $card.children('.tree-node-body').find('.tree-node-totals > span').each(function () {
                const $span = $(this);
                const txt = $span.text().trim();
                // "1,234 total steps" → "— total steps"; "∞ total steps" same idea
                const spaceIdx = txt.indexOf(' ');
                const suffix = spaceIdx > 0 ? txt.slice(spaceIdx + 1) : 'total steps';
                $span.text('— ' + suffix);
                $span.removeClass('tree-node-impossible');
            });
        }
        // Tree overview row for the same node — the minimap to the
        // right of the tree shows steps/item too. Blank it the same
        // way so the user isn't looking at the stale number there
        // either. The overview re-renders from node.metrics whenever
        // _renderTree runs (which happens on optimize complete via
        // rerenderAll → then subsequent interactions), so this just
        // needs to be a one-shot DOM update.
        const $overviewRow = this.$element
            .find(`.tree-overview-node[data-node-id="${nodeId}"]`).first();
        if ($overviewRow.length) {
            $overviewRow.find('.tree-overview-steps').each(function () {
                $(this).text('—')
                    .removeClass('tree-overview-steps-bank');
            });
        }
    }

    /**
     * Repopulate the per-node step numbers on every tree-node-card in
     * place, from the freshly-computed node.metrics + the annotator's
     * _displayed_* fields. The inverse of _clearNodeMetrics.
     *
     * WHY: _calculateOnly(preserveUI) and the manual "Rerun Summary"
     * button refresh the summary and re-run _annotateDisplayedCumulative,
     * but deliberately do NOT re-render the TreeNodeCards (to keep an open
     * ItemSelectionPopup / gear-preview alive). That left the card step
     * numbers stale while the summary "Total steps" updated — so the total
     * no longer matched the visible component cards, and rerunning the
     * summary never fixed it. This surgically syncs the cards to the SAME
     * numbers the annotator fed the summary. Formatting mirrors
     * tree-node-card.js exactly. Bug 5e9a6344 (2026-07-11).
     */
    _repopulateNodeMetrics() {
        if (!this.treeNodes || !this.treeNodes.length) return;
        const fmt = v => (v === Infinity ? '∞' : formatFixed(v, 1));
        const fmtInt = v => (v === Infinity ? '∞' : Math.round(v).toLocaleString());
        const rootId = (this.treeNodes.find(n => !n.parent_id) || {}).node_id;
        for (const node of this.treeNodes) {
            const $card = this.$element
                .find(`.tree-node-card[data-node-id="${node.node_id}"]`).first();
            if (!$card.length) continue;
            const metrics = node.metrics || {};
            const isRoot = node.node_id === rootId;
            const effRaw = (node.effective_quantity != null)
                ? node.effective_quantity
                : (node.base_requirement_amount || 1);
            const effCeil = (effRaw === Infinity || effRaw == null)
                ? effRaw
                : (isRoot ? effRaw : Math.max(1, Math.ceil(effRaw)));

            // Header "X steps/<noun>" — canonical per-node self rate.
            const selfStepsPerItem = (metrics.self_steps != null)
                ? metrics.self_steps : metrics.total_steps;
            const stepsPerItem = (selfStepsPerItem != null && isFinite(selfStepsPerItem)
                    && selfStepsPerItem > 0)
                ? selfStepsPerItem
                : metrics.steps_per_item;
            const stepsDisplay = stepsPerItem === Infinity ? '∞'
                : stepsPerItem === 0 ? 'Bank'
                : stepsPerItem != null ? formatFixed(stepsPerItem, 1) : '—';
            $card.children('.tree-node-header').find('.tree-node-steps').each(function () {
                const $span = $(this);
                const m = $span.text().match(/\s(.+)$/);
                $span.text(`${stepsDisplay} ${m ? m[1] : 'steps/item'}`);
            });

            // Qty chip "×N" — root stays fractional, others ceil (matches
            // the render-time logic in tree-node-card.js).
            const $qty = $card.children('.tree-node-header').find('.tree-node-qty').first();
            if ($qty.length) {
                let effStr;
                if (effRaw === Infinity || effRaw == null) {
                    effStr = '∞';
                } else if (isRoot && Math.abs(effRaw - Math.round(effRaw)) > 1e-9) {
                    effStr = formatFixed(effRaw, 2, { trim: true });
                } else {
                    effStr = Math.round(Math.ceil(effRaw)).toLocaleString();
                }
                $qty.text(`×${effStr}`);
            }

            // Body totals. "X total steps" == annotator self ceiled steps;
            // "total actions" adds the DA free-roll bonus then ceils
            // (non-root); "total steps per <noun>" == cumulative / ceil(eff).
            const totalSteps = (typeof node._displayed_self_steps === 'number')
                ? node._displayed_self_steps
                : null;
            const selfActionsPerItem = (metrics.self_actions != null)
                ? metrics.self_actions : metrics.total_actions;
            const rawActions = (selfActionsPerItem || 0) * effRaw;
            const stats = metrics.stats_used || {};
            const daBonus = (typeof stats.DA === 'number' && isFinite(stats.DA))
                ? Math.max(0, stats.DA) : 0;
            const effActionsRaw = (rawActions === Infinity || rawActions == null)
                ? rawActions : rawActions * (1 + daBonus);
            const totalActions = (effActionsRaw === Infinity || effActionsRaw == null)
                ? effActionsRaw
                : (isRoot ? effActionsRaw : Math.ceil(effActionsRaw));
            const cum = (typeof node._displayed_cumulative_steps === 'number')
                ? node._displayed_cumulative_steps : null;
            const perItem = (cum != null && cum !== Infinity
                    && effCeil && effCeil !== Infinity)
                ? cum / effCeil
                : (totalSteps != null && effCeil && effCeil !== Infinity
                    ? totalSteps / effCeil : null);

            $card.children('.tree-node-body').find('.tree-node-totals > span').each(function () {
                const $span = $(this);
                const txt = $span.text().trim();
                const spaceIdx = txt.indexOf(' ');
                const suffix = spaceIdx > 0 ? txt.slice(spaceIdx + 1) : '';
                if (/total steps per/.test(suffix)) {
                    if (perItem != null) $span.text(`${fmt(perItem)} ${suffix}`);
                } else if (/total actions/.test(suffix)) {
                    if (totalActions != null) {
                        $span.text(`${isRoot ? fmt(totalActions) : fmtInt(totalActions)} ${suffix}`);
                    }
                } else if (/total steps/.test(suffix)) {
                    if (totalSteps != null) {
                        $span.text(`${fmtInt(totalSteps)} ${suffix}`);
                        $span.toggleClass('tree-node-impossible', totalSteps === Infinity);
                    }
                }
            });

            // Tree overview minimap steps for this node.
            this.$element
                .find(`.tree-overview-node[data-node-id="${node.node_id}"] .tree-overview-steps`)
                .each(function () { $(this).text(stepsDisplay); });
        }
    }

    async _optimizeNode(nodeId) {
        const sessionUuid = store.get('session.uuid');
        console.log('Optimizing node:', nodeId, 'session:', sessionUuid);
        const targetNode = this.treeNodes.find(n => n.node_id === nodeId);
        console.log('Target node:', targetNode?.item_name, 'source:', targetNode?.source_type, 'gear_mode:', targetNode?.gear_config?.mode);

        // Set optimizing state on the button
        this._optimizingNodeIds = this._optimizingNodeIds || new Set();
        this._optimizingNodeIds.add(nodeId);
        const $btn = this.$element.find(`.tree-btn-optimize[data-node-id="${nodeId}"]`);
        $btn.addClass('optimizing').prop('disabled', true).html('<span class="spinner">⏳</span> Optimizing...');

        // Blank out this card's header steps/item + body totals so the
        // user isn't looking at stale pre-optimization numbers while the
        // worker runs. The values are re-populated on complete via the
        // existing rerenderAll path in _pollOptimization (which reads
        // node.metrics after _calculateOnly updates it).
        this._clearNodeMetrics(nodeId);

        // Also spin the top-level "Calculate & Optimize All" button while any node is optimizing
        this._updateMainOptimizeButtonState();

        // One-time nudge if this device benchmarked faster than the server.
        try { await maybeShowLocalSpeedWarning(); } catch (_) { /* non-fatal */ }

        try {
            const result = await api.optimizeCraftingTree(
                this.treeNodes, this.globalSettings, sessionUuid, [nodeId], true
            );
            console.log('Optimize API response:', result);
            this._pollOptimization(sessionUuid);
        } catch (err) {
            console.error('Optimize failed:', err);
            api.showError('Failed to optimize node');
            this._optimizingNodeIds.delete(nodeId);
            $btn.removeClass('optimizing').prop('disabled', false).text('Optimize');
            this._updateMainOptimizeButtonState();
        }
    }

    /**
     * Update the "Calculate & Optimize All" button state based on whether any
     * individual node optimization is currently in progress. Shows the spinner
     * and disables the button while anything is running.
     */
    _updateMainOptimizeButtonState() {
        const $btn = this.$element.find('.crafting-tree-calc-btn');
        if (!$btn.length) return;
        const anyOptimizing = this._isOptimizingAll || (this._optimizingNodeIds && this._optimizingNodeIds.size > 0);
        if (anyOptimizing) {
            if (!$btn.hasClass('optimizing')) {
                const label = this._isOptimizingAll ? 'Optimizing all...' : 'Optimizing node...';
                $btn.addClass('optimizing').prop('disabled', true)
                    .html(`<span class="spinner">⏳</span> ${label}`);
            }
        } else {
            $btn.removeClass('optimizing').prop('disabled', false)
                .text('Calculate & Optimize All');
        }
    }

    _pollOptimization(sessionUuid) {
        const self = this;
        let pollCount = 0;
        const poll = async () => {
            pollCount++;
            try {
                const status = await api.getCraftingTreeOptimizeStatus(sessionUuid);
                console.log(`Poll #${pollCount}:`, status.status, 'completed:', status.completed_nodes?.length, 'pending:', status.pending);
                self.optimizationStatus = status;
                if (status.status === 'complete') {
                    console.log('Optimization complete, completed nodes:', status.completed_nodes);
                    // Gear-aware Best(auto) route resolution (bug 9b3527ef) can
                    // rebuild whole subtrees (new node_ids), so a per-node merge
                    // can't reconcile structure changes. When the backend hands
                    // back the full updated tree, adopt it wholesale, then force
                    // a full _renderTree() below (the in-place rerender path only
                    // re-renders existing cards and would miss new child nodes).
                    self._optimizeAdoptedTree = false;
                    if (status.nodes && Array.isArray(status.nodes) && status.nodes.length) {
                        self.treeNodes = status.nodes;
                        self._optimizeAdoptedTree = true;
                        console.log('[CT-OPT] Adopted full updated tree from optimize:',
                            status.nodes.length, 'nodes (route resolution may have changed structure)');
                    }
                    for (const completed of (status.completed_nodes || [])) {
                        const node = self.treeNodes.find(n => n.node_id === completed.node_id);
                        if (node && completed.gearset_export) {
                            node.gear_config.optimized_export = completed.gearset_export;
                            console.log('Set gearset_export on node:', node.item_name);
                        }
                        if (node && completed.stats) {
                            node.gear_config.optimized_stats = completed.stats;
                        }
                        if (node && completed.selected_input_items) {
                            // Persist the per-node input item picks so the gear
                            // preview can render them next to tool5 and so Equip
                            // can copy them into column3.selectedInputItems.
                            node.gear_config.selected_input_items = completed.selected_input_items;
                        }
                        if (node && completed.alternatives) {
                            node.alternatives = completed.alternatives;
                        }
                        // Apply the worker's auto-picked pet/consumable so the
                        // gear preview shows them and _decode_gearset_stats can
                        // re-overlay them on later context changes (location/
                        // service swap, page reload). The optimizer's choice
                        // lives on node.gear_config.optimized_pet /
                        // optimized_consumable. Without applying these, the
                        // global "Optimize Pets / Optimize Consumables"
                        // toggles ran on the backend, the worker DID pick
                        // species + level + consumable, but the picks were
                        // dropped on the round-trip and the node persisted
                        // with selected_pet_id=null / selected_consumable_id=
                        // null. Bug 9ce474f8 (darkbow): "they were also not
                        // auto optimized even though I enabled that".
                        // Note: explicitly check `in` so a server-side `null`
                        // (worker decided no pet/consumable was beneficial)
                        // also clears the field, instead of being skipped.
                        if (node && 'optimized_pet' in completed) {
                            node.gear_config.optimized_pet = completed.optimized_pet || null;
                        }
                        if (node && 'optimized_consumable' in completed) {
                            node.gear_config.optimized_consumable = completed.optimized_consumable || null;
                        }
                        // Apply the slot_alternatives wrapper computed by
                        // the worker. The popup's tree-node-context path
                        // (tree-node-card.js ~L2136 → item-selection-popup.js
                        // ~L2585) reads gearConfig.slot_alternatives and
                        // splits it into alternatives + lockedAlternatives.
                        // Without this overlay, the worker's
                        // alternatives output was set on the backend's
                        // copy of the node but the frontend's local
                        // copy never saw it, so the popup's "Non-owned/
                        // Locked Upgrades" section stayed empty after
                        // every optimize. Use `in` so a server-side
                        // null (compute_slot_alternatives raised) also
                        // clears the field, mirroring optimized_pet
                        // above. Bug 331d38da.
                        if (node && 'slot_alternatives' in completed) {
                            node.gear_config.slot_alternatives =
                                completed.slot_alternatives || null;
                        }
                        // Apply best location found by worker (no-service recipe nodes)
                        // The worker emits completed.best_location when it
                        // picked a region on its own. Promote it straight
                        // onto node.last_auto_resolved_location; don't gate
                        // on completed.selected_location_id (the worker
                        // never sends that field for these nodes, so the
                        // old gate was silently dropping the result — which
                        // is why the location dropdown kept saying
                        // "Best (auto)" instead of "Best → <region>" after
                        // optimize).
                        if (node && completed.selected_location_id) {
                            node.selected_location_id = completed.selected_location_id;
                        }
                        if (node && completed.best_location) {
                            node.last_auto_resolved_location = completed.best_location;
                        } else if (node && completed.selected_location_id) {
                            // Worker echoed a user pick without an auto-
                            // resolved value — clear the stale auto marker.
                            node.last_auto_resolved_location = null;
                        }
                        console.log('[CT-OPT-APPLY]', {
                            nodeId: completed.node_id,
                            completed_best_location: completed.best_location,
                            completed_selected_location_id: completed.selected_location_id,
                            node_selected_location_id: node && node.selected_location_id,
                            node_last_auto_resolved_location: node && node.last_auto_resolved_location,
                        });
                        if (completed.error) {
                            console.warn(`Node ${completed.node_id} error:`, completed.error);
                            api.showError(`Optimization error: ${completed.error}`);
                        }
                    }
                    // Clear all optimizing states
                    self._optimizingNodeIds = new Set();
                    self._isOptimizingAll = false;
                    // Reset every per-node Optimize button back to its
                    // ready state. _calculateOnly(preserveUI=true) below
                    // mutates node data in place without re-rendering the
                    // cards, so the .optimizing class + disabled + spinner
                    // HTML we set on each button in _optimizeNode()
                    // would otherwise persist forever — the button would
                    // keep spinning even though the backend finished.
                    // Bug e4644b9d, user-reported "constantly spinning".
                    self.$element.find('.tree-btn-optimize.optimizing')
                        .removeClass('optimizing')
                        .prop('disabled', false)
                        .text('Optimize');
                    // Recalculate metrics only (don't re-optimize).
                    // Use preserveUI:true so the tree doesn't do a full
                    // re-render on completion — node data is mutated in
                    // place so existing dropdowns (location, service,
                    // source) keep their state. Logs what each completed
                    // node sent back so the location-label flow can be
                    // traced end-to-end.
                    for (const completed of (status.completed || [])) {
                        const n = self.treeNodes.find(nn => nn.node_id === completed.node_id);
                        console.log('[CT-OPT-COMPLETE]', {
                            nodeId: completed.node_id,
                            itemId: n && n.item_id,
                            best_location: completed.best_location,
                            selected_location_id_from_worker: completed.selected_location_id,
                            selected_location_id_on_node: n && n.selected_location_id,
                            last_auto_resolved_location: n && n.last_auto_resolved_location,
                            stats_location_before_recalc: n && n.metrics && n.metrics.stats_used && n.metrics.stats_used.location,
                        });
                    }
                    await self._calculateOnly(false, true);
                    // If route resolution handed us a structurally new tree,
                    // rebuild every card from scratch (the in-place rerenderAll
                    // below only re-renders existing card components and would
                    // leave new/removed subtree nodes unrendered). Bug 9b3527ef.
                    if (self._optimizeAdoptedTree) {
                        self._optimizeAdoptedTree = false;
                        try {
                            self._renderTree();
                        } catch (err) {
                            console.warn('[ct] full _renderTree after route resolution failed:', err);
                        }
                    }
                    // After _calculateOnly runs in preserveUI path, node
                    // metrics have been refreshed from the backend but
                    // _displayed_cumulative_steps (the post-order ceiled
                    // sum used by the body 'total steps per item' row)
                    // has NOT — that annotation only runs inside
                    // _renderTree. Without re-annotating, ancestor cards
                    // keep showing stale cumulative numbers (e.g. twine
                    // shows '39 total steps per item' forever because
                    // that's self-only and the cumulative fallback
                    // returns null). Also re-render every TreeNodeCard
                    // in the tree so each card's DOM reflects its fresh
                    // metrics — card.render() pulls all state from the
                    // shared node object, so dropdown selections and
                    // children_hidden state are preserved. Bug
                    // e4644b9d (user-reported 'cumulative doesn't
                    // propagate up after re-optimize').
                    try {
                        self._annotateDisplayedCumulative();
                    } catch (err) {
                        console.warn('[ct] _annotateDisplayedCumulative failed:', err);
                    }
                    const rerenderAll = (comps) => {
                        for (const c of (comps || [])) {
                            if (c && c.constructor && c.constructor.name === 'TreeNodeCard'
                                    && typeof c.render === 'function') {
                                try {
                                    c.render();
                                } catch (err) {
                                    console.warn('[ct] card re-render failed:', err);
                                }
                            }
                            if (c && c.childComponents) {
                                rerenderAll(c.childComponents);
                            }
                        }
                    };
                    rerenderAll(self.childComponents);
                    // Re-render the tree overview so per-node s/i
                    // values that the optimizer computed actually
                    // appear on the minimap immediately. Without
                    // this, the overview only refreshed on a full
                    // page reload (user reported 2026-05-15:
                    // "the crafting tree overview isn't showing the
                    // s/i value. It only shows it on a reload."). The
                    // re-render is cheap — the overview is a flat
                    // list — and reattachEvents preserves the click
                    // handlers for the Material options block.
                    const overviewComp = (self.childComponents || []).find(c => c && c.constructor && c.constructor.name === 'TreeOverview');
                    if (overviewComp) {
                        overviewComp.props.nodes = self.treeNodes;
                        overviewComp.props.optimizationStatus = self.optimizationStatus;
                        overviewComp.render();
                        overviewComp.attachEvents();
                    }
                    // Reset the main "Calculate & Optimize All" button
                    self._updateMainOptimizeButtonState();
                } else if (pollCount < 120) {
                    setTimeout(poll, 1000);
                } else {
                    console.warn('Optimization poll timeout');
                    api.showError('Optimization timed out');
                    self._optimizingNodeIds = new Set();
                    self._isOptimizingAll = false;
                    self._renderTree();
                    self._updateMainOptimizeButtonState();
                }
            } catch (err) {
                console.error('Poll error:', err);
            }
        };
        poll();
    }

    _selectAlternative(nodeId, altIndex) {
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (!node || !node.alternatives || !node.alternatives[altIndex]) return;
        const alt = node.alternatives[altIndex];
        if (alt.source_id) node.source_id = alt.source_id;
        if (alt.location_id) node.selected_location_id = alt.location_id;
        if (alt.gearset_export) node.gear_config.optimized_export = alt.gearset_export;
        this._debounceSave();
        this._renderTree();
    }

    _debounceSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveTreeState(), 500);
        // Also push to the store so the global undo/redo manager
        // captures this change (it subscribes on
        // ui.crafting_tree.nodes — see ui/static/js/undo-redo.js).
        // Without this, handlers that mutate node state in place and
        // only call _debounceSave (lock/pick/unequip via popup, input
        // pin, bank qty, gear-preview toggle, etc.) silently bypassed
        // undo/redo — only optimize / source-change / material-group
        // change / location-change paths reached the store. User-asked:
        // "undo/redo should affect EVERYTHING in the crafting tree".
        try {
            store.update('ui.crafting_tree.nodes', this.treeNodes);
        } catch (err) {
            console.warn('[ct] store.update on _debounceSave failed:', err);
        }
    }

    /**
     * Handle a per-slot change committed from the tree-node slot popup.
     *
     * `payload`:
     *   { type: 'lock' | 'pick',
     *     slot: <slotName>,
     *     itemId|slotItem: ...,
     *     locked: boolean,
     *     lockedSlots: { [slotName]: itemId|null, ... } }   // full map snapshot
     *
     * Per the locked-in spec (decisions A-D):
     *   - locked_slots persists on the tree node
     *   - lock is a HARD constraint — optimizer MUST honor it
     *   - parent gearsets are NOT re-optimized; only step counts propagate
     *   - lock-conflict detection (yellow ⚠️) — TODO follow-up
     *
     * For now this commits the full lockedSlots map to the node and
     * triggers a preserveUI recalc so the backend re-runs the per-node
     * optimizer with the new constraint, the metrics fan up the tree,
     * and the DOM updates in place.
     */
    _onTreeNodeSlotChange(nodeId, slot, payload) {
        if (!payload) return;
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (!node) {
            console.warn('[tree-slot-change] node not found:', nodeId);
            return;
        }
        // Mutate the node's locked_slots in place from the popup snapshot.
        // Spec: 'B - locked_slots persisted in DB tree state'. The
        // server-side recalc will read this and the JSON save path in
        // _saveTreeState picks it up.
        node.locked_slots = payload.lockedSlots && typeof payload.lockedSlots === 'object'
            ? { ...payload.lockedSlots }
            : (node.locked_slots || {});
        console.log('[tree-slot-change]', { nodeId, slot, type: payload.type, locked: payload.locked, lockedSlots: node.locked_slots });
        // Persist to backend (debounced) so the saved tree state carries
        // the new locks even before the recalc lands.
        this._debounceSave();
        // Surgically toggle the lock overlay on the affected slot tile.
        // We can't full-re-render the card (it would tear down the open
        // gear preview and the live popup over it). Just update this one
        // tile's outerHTML so the orange bubble appears/disappears live.
        try {
            const $slot = this.$element.find(`.tree-gear-mini-slot[data-slot="${slot}"][data-tree-node-id="${nodeId}"]`);
            if ($slot.length) {
                const isLocked = !!node.locked_slots[slot];
                let $existing = $slot.find('.tree-gear-mini-lock');
                if (isLocked && !$existing.length) {
                    $slot.append(`<span class="tree-gear-mini-lock" aria-label="Locked" title="Locked — optimizer must use this item">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
                            <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#e8820c" stroke-width="2.5" stroke-linecap="round"/>
                            <rect x="5" y="11" width="14" height="10" rx="2" fill="#e8820c"/>
                            <circle cx="12" cy="16" r="1.5" fill="#3d2503"/>
                        </svg>
                    </span>`);
                } else if (!isLocked && $existing.length) {
                    $existing.remove();
                }
                // On a `pick` (item swap), also rebuild the tile's
                // visible icon + rarity coloring + tooltip in place.
                // The card-level re-render was deliberately removed
                // (it tore down the open popup), so without this the
                // user picks an item and the slot keeps showing the
                // old one until the next natural re-render.
                if (payload.type === 'pick' && payload.slotItem) {
                    try {
                        const item = payload.slotItem;
                        // Resolve display icon: pets need
                        // level-appropriate path via getPetIconPath,
                        // everything else uses item.icon_path.
                        let iconPath = item.icon_path || '';
                        if (item.type === 'pet'
                            && item.level !== undefined
                            && item.level !== null
                            && typeof getPetIconPath === 'function') {
                            iconPath = getPetIconPath(
                                item.name || '',
                                item.level,
                                item.variant || 'normal',
                                item.max_level || 0
                            ) || iconPath;
                        }
                        const QUALITY_TO_RARITY = {
                            Normal: 'rarity-common', Good: 'rarity-uncommon',
                            Great: 'rarity-rare', Excellent: 'rarity-epic',
                            Perfect: 'rarity-legendary', Eternal: 'rarity-ethereal',
                            common: 'rarity-common', uncommon: 'rarity-uncommon',
                            rare: 'rarity-rare', epic: 'rarity-epic',
                            legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
                            fine: 'rarity-fine',
                        };
                        const rarityKey = item.quality || item.rarity || '';
                        const rarityClass = QUALITY_TO_RARITY[rarityKey] || '';
                        // Wipe any existing rarity-* classes, then
                        // restore the picked one. Also drop the empty-
                        // slot marker so the empty SVG doesn't sit
                        // alongside the new item icon.
                        const $tile = $slot;
                        const cls = ($tile.attr('class') || '')
                            .split(/\s+/)
                            .filter(c => c && !c.startsWith('rarity-')
                                && c !== 'tree-gear-mini-slot--empty')
                            .join(' ');
                        $tile.attr('class', cls + (rarityClass ? ' ' + rarityClass : ''));
                        $tile.attr('title', item.name || slot);
                        $tile.find('.tree-gear-mini-empty-icon').remove();
                        $tile.find('.travel-gear-mini-icon').remove();
                        // Bug b788d037 final follow-up: the in-place
                        // tile rebuild was setting the rarity class on
                        // the OUTER tile but the icon img was missing
                        // the `fine` class that the CSS
                        // .travel-gear-mini-icon.fine rule needs for
                        // the cyan drop-shadow. Add it here so manual
                        // Fine picks get the outline immediately
                        // (matches the gear-slot-grid pattern in
                        // gear-slot-grid.js).
                        const isFine = !!item.is_fine
                            || (typeof item.name === 'string' && item.name.includes('(Fine)'))
                            || rarityKey === 'fine';
                        // Defensive: if rarityClass didn't resolve to
                        // rarity-fine but item.is_fine is set, force
                        // it on the tile too. Same pattern as
                        // tree-node-card.js renderSlot.
                        if (isFine && rarityClass !== 'rarity-fine') {
                            $tile.attr(
                                'class',
                                ($tile.attr('class') || '').replace(/rarity-\w+/g, '').trim()
                                    + ' rarity-fine',
                            );
                        }
                        const iconClass = `travel-gear-mini-icon${isFine ? ' fine' : ''}`;
                        if (iconPath) {
                            // Insert the icon before any trailing
                            // lock overlay so the badge stays in the
                            // top-right corner.
                            const $iconHtml = $(`<img alt="${(item.name || '').replace(/"/g, '&quot;')}" class="${iconClass}" loading="lazy" src="${iconPath}">`);
                            const $lock = $tile.find('.tree-gear-mini-lock');
                            if ($lock.length) {
                                $lock.before($iconHtml);
                            } else {
                                $tile.append($iconHtml);
                            }
                        }
                    } catch (err) {
                        console.warn('[tree-slot-change] in-place tile icon update failed', err);
                    }
                }
                // Unequip — rebuild this slot's tile to the empty
                // state so the icon disappears immediately. The user
                // saw the icon stick around until they reopened the
                // crafting tree because the popup unequip path only
                // dropped the lock; the optimizer's pick (still in
                // optimized_export) painted the tile on next render.
                // Now we set lockedSlots[slot] = null (force-empty
                // sentinel) and rebuild the tile here so the visual
                // matches the pin immediately.
                if (payload.type === 'unequip') {
                    try {
                        const $tile = $slot;
                        const cls = ($tile.attr('class') || '')
                            .split(/\s+/)
                            .filter(c => c && !c.startsWith('rarity-'))
                            .join(' ');
                        // Add the empty-slot marker back, drop any
                        // existing item icon + lock overlay (a force-
                        // empty pin doesn't show a lock badge — the
                        // slot is just empty).
                        $tile.attr('class', cls + ' tree-gear-mini-slot--empty');
                        $tile.attr('title', `Empty ${slot} slot — click to pick`);
                        $tile.find('.travel-gear-mini-icon').remove();
                        $tile.find('.tree-gear-mini-empty-icon').remove();
                        $tile.find('.tree-gear-mini-lock').remove();
                        // slotIconFamily logic: ring → ring, tool0..5
                        // → tool, ring1/ring2 → ring; everything else
                        // is the slot name itself. Mirrors the
                        // helper in tree-node-card.js.
                        let family = slot;
                        if (slot.startsWith('ring')) family = 'ring';
                        else if (slot.startsWith('tool')) family = 'tool';
                        const slotIcon = `/assets/icons/slots/${family}.svg`;
                        $tile.append(`<img src="${slotIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">`);
                    } catch (err) {
                        console.warn('[tree-slot-change] unequip tile rebuild failed', err);
                    }
                }
                // Bug b788d037 final follow-up: lock toggle to UNLOCK
                // didn't rebuild the tile icon — only removed the
                // orange lock badge. The tile kept showing whatever
                // was last drawn (the user's manually-picked item),
                // even though node.locked_slots no longer carried that
                // pin. Re-opening the popup correctly read the cleared
                // state and showed the optimizer's auto-pick — so
                // tile and popup mismatched.
                //
                // Resolution: when type='lock' and locked is false,
                // resolve what the slot SHOULD show given current
                // node state (locked_slots is already cleared, so
                // we fall back to optimized_pet/_consumable for
                // those slots, or to the optimized_export decoded
                // slot for gear/tools/rings). Then rebuild the tile
                // icon in place — same surgical pattern as the
                // 'pick' branch above, just sourced from the
                // optimized state instead of payload.slotItem.
                if (payload.type === 'lock' && payload.locked === false) {
                    try {
                        let resolvedItem = null;
                        if (slot === 'pet' && node?.gear_config?.optimized_pet) {
                            resolvedItem = { ...node.gear_config.optimized_pet, type: 'pet' };
                        } else if (slot === 'consumable' && node?.gear_config?.optimized_consumable) {
                            resolvedItem = { ...node.gear_config.optimized_consumable, type: 'consumable' };
                        } else if (node?.gear_config?.optimized_export) {
                            // For gear/tools/rings, decode the export
                            // and find this slot. We use the same
                            // _decodeGearsetSlots helper TreeNodeCard
                            // uses for the gear preview — it lives on
                            // the card prototype so we have to walk
                            // the children to find the card.
                            const findCard = (comps) => {
                                for (const c of (comps || [])) {
                                    if (c?.constructor?.name === 'TreeNodeCard'
                                            && c.props?.node?.node_id === nodeId) {
                                        return c;
                                    }
                                    if (c?.childComponents) {
                                        const hit = findCard(c.childComponents);
                                        if (hit) return hit;
                                    }
                                }
                                return null;
                            };
                            const card = findCard(this.childComponents);
                            if (card && typeof card._decodeGearsetSlots === 'function') {
                                const decoded = card._decodeGearsetSlots(node.gear_config.optimized_export) || {};
                                if (decoded[slot]) {
                                    resolvedItem = decoded[slot];
                                }
                            }
                        }

                        const $tile = $slot;
                        if (resolvedItem) {
                            // Rebuild tile to match optimized state.
                            // Reuse the same icon/rarity logic as the
                            // pick branch — but resolvedItem comes from
                            // optimizer state, not user pick.
                            let iconPath = resolvedItem.icon_path || '';
                            if (resolvedItem.type === 'pet'
                                    && resolvedItem.level !== undefined
                                    && resolvedItem.level !== null
                                    && typeof getPetIconPath === 'function') {
                                iconPath = getPetIconPath(
                                    resolvedItem.name || '',
                                    resolvedItem.level,
                                    resolvedItem.variant || 'normal',
                                    resolvedItem.max_level || 0,
                                ) || iconPath;
                            }
                            const QUALITY_TO_RARITY = {
                                Normal: 'rarity-common', Good: 'rarity-uncommon',
                                Great: 'rarity-rare', Excellent: 'rarity-epic',
                                Perfect: 'rarity-legendary', Eternal: 'rarity-ethereal',
                                common: 'rarity-common', uncommon: 'rarity-uncommon',
                                rare: 'rarity-rare', epic: 'rarity-epic',
                                legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
                                fine: 'rarity-fine',
                            };
                            const rarityKey = resolvedItem.quality || resolvedItem.rarity || '';
                            const rarityClass = QUALITY_TO_RARITY[rarityKey] || '';
                            const isFine = !!resolvedItem.is_fine
                                || (typeof resolvedItem.name === 'string' && resolvedItem.name.includes('(Fine)'))
                                || rarityKey === 'fine';
                            const cls = ($tile.attr('class') || '')
                                .split(/\s+/)
                                .filter(c => c && !c.startsWith('rarity-')
                                    && c !== 'tree-gear-mini-slot--empty')
                                .join(' ');
                            const finalRarityClass = isFine ? 'rarity-fine' : rarityClass;
                            $tile.attr('class', cls + (finalRarityClass ? ' ' + finalRarityClass : ''));
                            $tile.attr('title', resolvedItem.name || slot);
                            $tile.find('.tree-gear-mini-empty-icon').remove();
                            $tile.find('.travel-gear-mini-icon').remove();
                            // No lock badge after unlock — the badge
                            // was already removed by the lock-overlay
                            // toggle code further up.
                            if (iconPath) {
                                const iconClass = `travel-gear-mini-icon${isFine ? ' fine' : ''}`;
                                const $iconHtml = $(`<img alt="${(resolvedItem.name || '').replace(/"/g, '&quot;')}" class="${iconClass}" loading="lazy" src="${iconPath}">`);
                                $tile.append($iconHtml);
                            }
                        } else {
                            // No resolved item — render empty state
                            // (slot has nothing in optimizer's pick
                            // either, e.g. unlock on an empty
                            // pet/consumable slot before optimize).
                            const cls = ($tile.attr('class') || '')
                                .split(/\s+/)
                                .filter(c => c && !c.startsWith('rarity-'))
                                .join(' ');
                            $tile.attr('class', cls + ' tree-gear-mini-slot--empty');
                            $tile.attr('title', `Empty ${slot} slot — click to pick`);
                            $tile.find('.travel-gear-mini-icon').remove();
                            $tile.find('.tree-gear-mini-empty-icon').remove();
                            let family = slot;
                            if (slot.startsWith('ring')) family = 'ring';
                            else if (slot.startsWith('tool')) family = 'tool';
                            const slotIcon = `/assets/icons/slots/${family}.svg`;
                            $tile.append(`<img src="${slotIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">`);
                        }
                    } catch (err) {
                        console.warn('[tree-slot-change] unlock tile rebuild failed', err);
                    }
                }
            }
        } catch (err) {
            console.warn('[tree-slot-change] in-place lock overlay update failed', err);
        }
        // Clear the optimizer's cached stats so the backend is forced to
        // re-derive from the export string (with our new locked_slots
        // patched in by _decode_gearset_stats). Without this, _get_gear_stats
        // short-circuits to the cached optimized_stats and the lock has no
        // visible effect on WE/DR/DA.
        if (node.gear_config) {
            node.gear_config.optimized_stats = null;
        }
        // Light-weight recalc: NOT _optimizeNode (which would round-trip
        // through the backend optimizer and re-pick all the unlocked
        // slots, fighting the user's intent). _calculateOnly walks the
        // tree and recomputes stats + steps from existing gear_configs;
        // the backend now applies node.locked_slots as gearset overrides
        // before stat aggregation. preserveUI keeps the DOM in place so
        // the user can keep clicking other slots without flicker.
        // (preserveUI no longer re-renders TreeNodeCards — see comment
        // in _calculateOnly. Per-slot icon swaps stay stale until the
        // next natural re-render; the lock badge above is updated in
        // place so the lock state is at least visible immediately.)
        this._calculateOnly(false, /*preserveUI*/ true).catch(err => {
            console.error('[tree-slot-change] recalc failed:', err);
            api.showError('Slot lock saved, but recalc failed — try Optimize manually.');
        });
    }

    /**
     * Handle a per-input-item change committed from the activity input
     * slot popup.
     *
     * `payload`:
     *   { type: 'pick', item: {itemId, name, icon_path, ...} }
     *   { type: 'unlock' }
     *
     * Input items are pinned on `node.gear_config.user_input_items[idx]`,
     * which the worker invocation in app.py overlays over the auto-picked
     * default (auto-pick fills any unpinned slot). Pin = lock semantics
     * (matches the gear slot popup design): a pick is a commitment, an
     * unlock drops the pin so the next Optimize falls back to auto-pick.
     *
     * preserveUI recalc only refreshes step counts — the actual stat
     * impact of swapping inputs requires a fresh Optimize run, since
     * INPUT_ITEM is consumed inside the optimizer's greedy/local-search
     * loops.
     */
    _onTreeNodeInputChange(nodeId, idx, payload) {
        if (!payload) return;
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (!node) {
            console.warn('[tree-input-change] node not found:', nodeId);
            return;
        }
        if (!node.gear_config) node.gear_config = {};
        const userInputs = { ...(node.gear_config.user_input_items || {}) };
        if (payload.type === 'pick' && payload.item) {
            userInputs[String(idx)] = payload.item;
        } else if (payload.type === 'unlock') {
            delete userInputs[String(idx)];
            delete userInputs[idx];
        }
        node.gear_config.user_input_items = userInputs;
        // Update the rendered selected_input_items map too so the slot
        // tile shows the picked item immediately, before the next
        // optimize echoes selected_input_items back from the worker.
        // Worker auto-pick will overwrite this on next Optimize, but
        // user_input_items takes precedence in the merge.
        const selected = { ...(node.gear_config.selected_input_items || {}) };
        if (payload.type === 'pick' && payload.item) {
            selected[String(idx)] = payload.item;
        } else if (payload.type === 'unlock') {
            // Don't clear selected — leave the auto-picked item visible
            // until the next optimize re-resolves. Drop the pin only.
        }
        node.gear_config.selected_input_items = selected;
        console.log('[tree-input-change]', { nodeId, idx, type: payload.type, name: payload.item?.name });
        this._debounceSave();
        // Surgically rebuild the input slot tile in place so the icon
        // swap is visible immediately. The full card re-render path
        // would tear down the open popup state; matches the gear-slot
        // pick handler.
        try {
            const $tile = this.$element
                .find(`.tree-gear-mini-slot--input[data-input-idx="${idx}"][data-tree-node-id="${nodeId}"]`);
            if ($tile.length) {
                const equipped = userInputs[String(idx)] || selected[String(idx)];
                const inputMeta = (node.activity_input_items || [])[idx] || {};
                const slotIconKey = (inputMeta.name || '').toLowerCase()
                    .replace(/ /g, '_')
                    .replace(/[^a-z0-9_]/g, '');
                const slotFamilyIcon = `/assets/icons/keywords/${slotIconKey}.svg`;
                const QUALITY_TO_RARITY_MAP = {
                    Normal: 'rarity-common', Good: 'rarity-uncommon',
                    Great: 'rarity-rare', Excellent: 'rarity-epic',
                    Perfect: 'rarity-legendary', Eternal: 'rarity-ethereal',
                    common: 'rarity-common', uncommon: 'rarity-uncommon',
                    rare: 'rarity-rare', epic: 'rarity-epic',
                    legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
                    fine: 'rarity-fine',
                };
                const cls = ($tile.attr('class') || '')
                    .split(/\s+/)
                    .filter(c => c && !c.startsWith('rarity-')
                        && c !== 'tree-gear-mini-slot--empty')
                    .join(' ');
                $tile.find('.travel-gear-mini-icon, .tree-gear-mini-empty-icon').remove();
                if (equipped) {
                    const rarityClass = QUALITY_TO_RARITY_MAP[equipped.quality || equipped.rarity] || '';
                    $tile.attr('class', cls + (rarityClass ? ' ' + rarityClass : ''));
                    $tile.attr('title', equipped.name || inputMeta.name || 'Input item');
                    if (equipped.icon_path) {
                        const $icon = $(`<img alt="${(equipped.name || '').replace(/"/g, '&quot;')}" class="travel-gear-mini-icon" loading="lazy" src="${equipped.icon_path}">`);
                        const $lock = $tile.find('.tree-gear-mini-lock');
                        if ($lock.length) {
                            $lock.before($icon);
                        } else {
                            $tile.append($icon);
                        }
                    }
                } else {
                    // Back to empty-state — show keyword family icon.
                    $tile.attr('class', cls + ' tree-gear-mini-slot--empty');
                    $tile.attr('title', `Click to pick ${inputMeta.name || 'input'}${inputMeta.level ? ` (Lv.${inputMeta.level}+)` : ''}`);
                    const $emptyIcon = $(`<img src="${slotFamilyIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">`);
                    const $lock = $tile.find('.tree-gear-mini-lock');
                    if ($lock.length) {
                        $lock.before($emptyIcon);
                    } else {
                        $tile.prepend($emptyIcon);
                    }
                }
                // Toggle the lock badge.
                const isLocked = !!userInputs[String(idx)];
                let $existing = $tile.find('.tree-gear-mini-lock');
                if (isLocked && !$existing.length) {
                    $tile.append(`<span class="tree-gear-mini-lock" role="button" tabindex="0" aria-label="Click to unlock" title="Click to unlock — optimizer can pick its own item">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
                            <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#e8820c" stroke-width="2.5" stroke-linecap="round"/>
                            <rect x="5" y="11" width="14" height="10" rx="2" fill="#e8820c"/>
                            <circle cx="12" cy="16" r="1.5" fill="#3d2503"/>
                        </svg>
                    </span>`);
                } else if (!isLocked && $existing.length) {
                    $existing.remove();
                }
            }
        } catch (err) {
            console.warn('[tree-input-change] in-place tile update failed', err);
        }
        // No _calculateOnly here: input-item changes don't affect step
        // counts on their own (the input is consumed; the gearset stats
        // already factored DR/DA at optimize time). The user must re-
        // optimize to see the new input reflected in the gearset.
    }

    /**
     * Reset a tree node's gear state: clear the optimizer's pick,
     * every user pin (locked_slots, user_input_items,
     * selected_input_items), the lock-conflict warning, and the
     * cached optimized stats. The card's gear preview re-renders to
     * all-empty slots, ready for a fresh Optimize click.
     *
     * Done as a full TreeNodeCard re-render (not a surgical update)
     * because there's no open popup state to preserve — the user
     * clicked a button on the card itself, not interacted with a
     * slot — and the empty-state preview is a different layout from
     * the populated one (lots of tiles change at once). After the
     * card re-renders we kick off _calculateOnly(preserveUI) so the
     * step counts/summary update without rebuilding the rest of the
     * tree.
     */
    _onTreeNodeReset(nodeId) {
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (!node) {
            console.warn('[tree-node-reset] node not found:', nodeId);
            return;
        }
        // Wipe gear-config fields tied to a specific optimization run.
        if (!node.gear_config) node.gear_config = {};
        node.gear_config.optimized_export = null;
        node.gear_config.optimized_stats = null;
        node.gear_config.selected_input_items = {};
        node.gear_config.user_input_items = {};
        node.gear_config.lock_warning = null;
        node.gear_config.slot_alternatives = null;
        // Optimizer's pet + consumable picks. Bug b788d037 last
        // follow-up: Reset wiped gear/tools/rings via clearing
        // optimized_export, but pet + consumable lived on
        // .optimized_pet / .optimized_consumable and weren't being
        // touched. The preview kept showing the optimizer's pet+
        // consumable after Reset, contradicting the user's intent
        // ("Reset all gear including pet+consumable").
        node.gear_config.optimized_pet = null;
        node.gear_config.optimized_consumable = null;
        // Drop every user pin so the next Optimize is unconstrained.
        node.locked_slots = {};
        console.log('[tree-node-reset]', { nodeId });
        this._debounceSave();
        // Find the card component for this node and re-render it.
        const findCard = (comps) => {
            for (const c of (comps || [])) {
                if (c?.constructor?.name === 'TreeNodeCard'
                        && c.props?.node?.node_id === nodeId) {
                    return c;
                }
                if (c?.childComponents) {
                    const hit = findCard(c.childComponents);
                    if (hit) return hit;
                }
            }
            return null;
        };
        const card = findCard(this.childComponents);
        if (card && typeof card.render === 'function') {
            try { card.render(); } catch (err) {
                console.warn('[tree-node-reset] card re-render failed:', err);
            }
        }
        // Refresh the summary + parent step counts. preserveUI keeps
        // the rest of the tree in place.
        this._calculateOnly(false, /*preserveUI*/ true).catch(err => {
            console.error('[tree-node-reset] recalc failed:', err);
            api.showError('Reset done, but recalc failed — try Optimize manually.');
        });
        api.showInfo('Gear reset for this node');
    }

    _equipNodeGearset(nodeId) {
        const node = this.treeNodes.find(n => n.node_id === nodeId);
        if (!node || !node.gear_config?.optimized_export) {
            api.showError('No optimized gearset to equip');
            return;
        }

        const exportString = node.gear_config.optimized_export;
        const sourceType = node.source_type === 'best' ? (node.underlying_source_type || 'activity') : node.source_type;
        // source_id from the backend is the display name (e.g. "Butterfly catching", "Iron Sickle").
        // We need to resolve it to the API id used by the selectors.
        const rawSourceId = node.source_type === 'best' ? (node.underlying_source_id || node.source_id) : node.source_id;
        const stats = node.metrics?.stats_used || {};
        const location = stats.location || node.selected_location_id || null;

        // Resolve display name → API id by looking up in the cached selector data.
        let resolvedSourceId = rawSourceId;
        if (sourceType === 'activity' && rawSourceId && window.activitySelector?.activitiesData) {
            for (const acts of Object.values(window.activitySelector.activitiesData.by_skill || {})) {
                const match = acts.find(a => a.name === rawSourceId || a.id === rawSourceId);
                if (match) { resolvedSourceId = match.id; break; }
            }
        } else if (sourceType === 'recipe' && rawSourceId && window.recipeSelector?.recipesData) {
            for (const recs of Object.values(window.recipeSelector.recipesData.by_skill || {})) {
                const match = recs.find(r => r.name === rawSourceId || r.id === rawSourceId);
                if (match) { resolvedSourceId = match.id; break; }
            }
        }

        console.log(`[EquipNode] sourceType=${sourceType} rawSourceId=${rawSourceId} resolvedSourceId=${resolvedSourceId}`);

        // Save tree state before closing
        this._saveTreeState();

        // Close the crafting tree overlay
        if (this.props.onClose) {
            this.props.onClose();
        }

        // Equip the gearset and select the activity/recipe in Column 3
        setTimeout(async () => {
            try {
                // Build extraSlots from the node's optimized pet/consumable so
                // they ride through to the column-2 gear preview. Without
                // this, Equip from a tree node loaded ONLY the gearset
                // export string — which can't carry pet or consumable
                // (encode_gearset only serializes gear/tools/rings; the
                // Gearset class has no _pet/_consumable attribute). The
                // user reported (3bb938f4 third follow-up): "when I click
                // 'equip' it's not equipping the consumable or pet to the
                // slots properly in column 2".
                //
                // The pet/consumable picks live on
                // gear_config.optimized_pet / .optimized_consumable
                // (worker persists them there alongside the export string;
                // see _extract_pet_consumable_meta in optimize_worker.py).
                // loadGearSetFromExport's extraSlots merge (~line 1613)
                // takes care of getting them into state.gearsets.current.
                const extraSlots = {};
                const optPet = node.gear_config?.optimized_pet;
                const optCons = node.gear_config?.optimized_consumable;
                if (optPet) {
                    extraSlots.pet = { ...optPet, type: 'pet' };
                }
                if (optCons) {
                    extraSlots.consumable = { ...optCons, type: 'consumable' };
                }
                // Bug b788d037 follow-up: when the user changes any gear
                // in the gear preview (via the slot popup) and clicks
                // Equip, the overrides are stored in node.locked_slots.
                // The OLD Equip flow ignored those — it equipped only
                // the optimizer's stored gearset. Now layer locked_slots
                // on top of optimizer picks so the user's manual choices
                // win. loadGearSetFromExport's extraSlots merge is now
                // OVERRIDE-semantic (also part of this commit), so any
                // gear/tools/rings entry replaces the export-derived
                // slot, and pet/consumable locks override the
                // optimizer's auto-pick.
                const lockedSlots = node.locked_slots || {};
                for (const [slotName, lockedItem] of Object.entries(lockedSlots)) {
                    if (lockedItem === null) {
                        // Explicit "unequip" sentinel (popup Unequip
                        // button writes null). Honor as a force-empty.
                        extraSlots[slotName] = null;
                        continue;
                    }
                    if (!lockedItem) continue;
                    extraSlots[slotName] = { ...lockedItem };
                }
                // Equip the gearset via store — loadGearSetFromExport handles catalog enrichment
                await store.loadGearSetFromExport(
                    exportString,
                    null,
                    node.item_name || 'Crafting Tree Gearset',
                    Object.keys(extraSlots).length > 0 ? extraSlots : null,
                );

                // Apply the tree node's auto-picked input items to column3 so
                // Column 3's activity-info section shows them in the input
                // slots — exactly as if the user had picked them manually.
                const treeInputItems = node.gear_config?.selected_input_items;
                if (treeInputItems && Object.keys(treeInputItems).length > 0) {
                    // Normalize keys to numeric indices (backend serializes as
                    // strings for JSON round-trip).
                    const normalized = {};
                    for (const [k, v] of Object.entries(treeInputItems)) {
                        if (v) normalized[Number(k)] = v;
                    }
                    store.state.column3.selectedInputItems = normalized;
                    store._notifySubscribers('column3.selectedInputItems');
                    try { store._saveColumn3Selection(); } catch (_) {}
                }

                // Select the activity or recipe in Column 3
                if (sourceType === 'recipe' && resolvedSourceId) {
                    store.state.column3.selectedRecipe = resolvedSourceId;
                    store.state.column3.selectedActivity = null;
                    store._notifySubscribers('column3.selectedRecipe');
                    store._notifySubscribers('column3.selectedActivity');
                    store._saveColumn3Selection();
                } else if (sourceType === 'activity' && resolvedSourceId) {
                    store.state.column3.selectedActivity = resolvedSourceId;
                    store.state.column3.selectedRecipe = null;
                    store._notifySubscribers('column3.selectedActivity');
                    store._notifySubscribers('column3.selectedRecipe');
                    if (location) {
                        store.update('ui.column3.selectedLocation', location);
                    }
                    store._saveColumn3Selection();
                }

                api.showSuccess(`Gearset equipped for ${node.item_name}`);
            } catch (err) {
                console.error('Failed to equip gearset:', err);
                api.showError('Failed to equip gearset');
            }
        }, 300); // Wait for overlay close animation
    }

    async _saveTreeState() {
        const sessionUuid = store.get('session.uuid');
        if (!sessionUuid) return;
        try {
            await api.updateConfig(sessionUuid, 'crafting_tree', {
                target_item_id: store.get('ui.crafting_tree.target_item_id'),
                data_version: TREE_DATA_VERSION,
                nodes: this.treeNodes,
                global_settings: this.globalSettings,
            });
        } catch (err) {
            console.error('Failed to save tree state:', err);
        }
    }

    destroy() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        $(document).off('keydown.crafting-tree');
        $(document).off('click.ct-preset');
        if (this._renderObserver) {
            try { this._renderObserver.disconnect(); } catch (_) { /* noop */ }
            this._renderObserver = null;
        }
        this.childComponents.forEach(c => c.destroy());
        this.childComponents = [];
        this.$element.off('click');
        if (window._craftingTreeViewGlobal === this) {
            window._craftingTreeViewGlobal = null;
        }
        super.destroy();
    }
}

export default CraftingTreeView;
