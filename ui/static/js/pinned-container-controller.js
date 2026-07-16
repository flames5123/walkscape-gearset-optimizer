/**
 * PinnedContainerController — the singleton orchestrator for the Pin Item
 * feature.
 *
 * Owns:
 *   - Pin State: ordered list of Pin Path descriptors.
 *   - Observer + mirror registries: one MutationObserver per unique Pin Source.
 *   - Selection Mode FSM.
 *   - Feature-intro-popup gate.
 *   - Session-config persistence (300ms debounced PATCH /api/session/{uuid}/config).
 *
 * Responsibilities by section:
 *   §5 Controller + FSM: onPinIconClick, _enter/_exit, setPinTarget, moveUp/Down, confirm
 *   §6 Overlay + Picker: owns instances, receives callbacks
 *   §7 Mirror engine: ensureMirror, observer callback, rAF drain, stale retry, re-dispatch
 *   §10 Persistence: loadFromSession, _persistPinState, _persistPanel
 *
 * Exposed globally as `window.pinnedContainerController`.
 */

import store from './state.js';
import api from './api.js';
import { clampSplit } from './utils/split-clamp.js';
import { printPinPath, resolvePinPath, pinPathKey, pinPathEquals } from './utils/pin-path.js';
import { reorder } from './utils/pinned-reorder.js';
import PinSelectionOverlay, { isPinnable, pinnableRootFor, PINNABLE_ROOT_IDS } from './components/pin-selection-overlay.js';
import GranularityPicker from './components/granularity-picker.js';
import PinnedContainer from './components/pinned-container.js';
import PinnedSavesPresetBar from './components/pinned-saves-preset-bar.js';
import PinFeatureIntroPopup from './components/pin-feature-intro-popup.js';

// ----- FSM state constants ---------------------------------------------------
const STATE_IDLE = 'Idle';
const STATE_INTRO_GATE = 'IntroGate';
const STATE_SELECTING_HOVER = 'Selecting_Hover';
const STATE_SELECTING_TARGET_SET = 'Selecting_Target_Set';

// ----- Persistence keys ------------------------------------------------------
const CONFIG_PATH_PIN_STATE = 'ui.pinned_state';
const CONFIG_PATH_INTRO_DISMISSED = 'ui.pinned_intro_dismissed';
const CONFIG_PATH_PANEL_PREFIX = 'ui.pinned_panel';

const DEFAULT_SPLITS = {
    desktop: 20,
    mobile_portrait: 30,
    mobile_landscape: 25,
};

const DEFAULT_COLLAPSED = {
    desktop: false,
    mobile_portrait: true,
    mobile_landscape: true,
};

// Debounce constants
const PERSIST_DEBOUNCE_MS = 300;
const STALE_RETRY_MS = 250;
const STALE_CLEAR_MS = 3000;

// ============================================================================
// CONTROLLER
// ============================================================================

class PinnedContainerController {
    constructor() {
        this.pinState = [];
        this.modeState = STATE_IDLE;
        this.pinTarget = null;
        this._clickedLeaf = null;
        this.overlay = null;
        this.picker = null;
        this.container = null;
        this.presetBar = null;
        this.introPopup = null;

        // pathKey -> { descriptor, source, observer, mirrorRoot, pinnedItem, $item, lastResolvedAt, retryTimer, retryFailSince }
        this.mirrors = new Map();

        // Guards
        this._syncing = false;
        this._reDispatching = false;

        // rAF queue for coalescing mutation-driven syncs
        this._rafQueue = new Set();
        this._rafHandle = null;

        // Persistence debounces — one timer per path
        this._persistTimers = new Map();

        this._pinIconInitialized = false;
        this._sessionLoaded = false;

        this._panelRootObserver = null;
    }

    // ------------------------------------------------------------------
    // Public entry points
    // ------------------------------------------------------------------

    /** Called once by main.js after the session is loaded. */
    init() {
        const btn = document.getElementById('pin-mode-btn');
        if (btn && !this._pinIconInitialized) {
            btn.addEventListener('click', () => this.onPinIconClick());
            this._pinIconInitialized = true;
        }
        this._sessionLoaded = true;
        this.loadFromSession();
    }

    /** Handler for clicks on the top-bar Pin Icon. */
    onPinIconClick() {
        // The notepad overlay sits above the page; pin selection mode targets
        // page elements and would be unusable (and visually broken) while it's
        // open, so ignore pin-icon clicks until the notepad is closed.
        if (window.location.hash === '#notepad') return;
        if (this.modeState !== STATE_IDLE) {
            // Toggle-off: exit selection mode without pinning.
            this.exitSelectionMode();
            return;
        }
        const dismissed = this._getConfig(CONFIG_PATH_INTRO_DISMISSED) === true;
        if (!dismissed) {
            this._showIntroPopupThenEnter();
        } else {
            this._enterSelectionMode();
        }
    }

    // ------------------------------------------------------------------
    // Selection Mode FSM
    // ------------------------------------------------------------------

    _showIntroPopupThenEnter() {
        if (this.introPopup && this.introPopup.isVisible) return; // debounce rapid clicks
        this.modeState = STATE_INTRO_GATE;
        this.introPopup = new PinFeatureIntroPopup({
            onDismiss: () => {
                this._setConfig(CONFIG_PATH_INTRO_DISMISSED, true);
                this.introPopup = null;
                this._enterSelectionMode();
            },
        });
        this.introPopup.show();
    }

    _enterSelectionMode() {
        this.modeState = STATE_SELECTING_HOVER;
        this._updatePinIconActive(true);

        this.overlay = new PinSelectionOverlay({
            onTargetSet: (el, opts) => this.setPinTarget(el, opts || {}),
            onIneligibleTap: (_el) => this.onIneligibleTap(),
            // onConfirm is unused now — the overlay routes clicks to
            // onTargetSet so users can walk the ancestor chain with
            // Up/Down before committing with the picker's Confirm button.
            onEscape: () => this.exitSelectionMode(),
            onKeyNav: (dir) => this._onKeyNav(dir),
        });
        this.overlay.mount();

        this.picker = new GranularityPicker({
            onUp: () => this.moveTargetUp(),
            onDown: () => this.moveTargetDown(),
            onConfirm: () => this.confirmCurrentTarget(),
        });
        this.picker.mount();
        this.picker.setTarget(null); // hidden until a target is set
    }

    exitSelectionMode() {
        if (this.modeState === STATE_IDLE) return;
        this._updatePinIconActive(false);
        if (this.overlay) { this.overlay.unmount(); this.overlay = null; }
        if (this.picker) { this.picker.unmount(); this.picker = null; }
        this.pinTarget = null;
        this._clickedLeaf = null;
        this.modeState = STATE_IDLE;
    }

    /**
     * Set the pin target.
     *
     * @param {Element} el
     * @param {Object} [opts]
     * @param {boolean} [opts.fromClick=false]  If true, the user just clicked/
     *   tapped this element. Remember it as the "interesting leaf" so that
     *   walking back down via moveTargetDown() returns toward it instead of
     *   picking an arbitrary first pinnable child.
     */
    setPinTarget(el, opts = {}) {
        if (!el || !isPinnable(el)) return;
        this.pinTarget = el;
        if (opts.fromClick || !this._clickedLeaf || !el.contains(this._clickedLeaf)) {
            // Either the user just clicked, or the new target is "above" the
            // previous clicked leaf in a different subtree — reset the leaf.
            this._clickedLeaf = el;
        }
        this.modeState = STATE_SELECTING_TARGET_SET;
        if (this.overlay) this.overlay.applyHighlight(el);
        if (this.picker) this.picker.setTarget(el);
    }

    moveTargetUp() {
        if (!this.pinTarget) return;
        const root = pinnableRootFor(this.pinTarget);
        if (!root) return;
        const parent = this.pinTarget.parentElement;
        if (!parent || parent === root) return;
        if (!root.contains(parent)) return;
        // Preserve the clicked leaf when walking up.
        this.pinTarget = parent;
        this.modeState = STATE_SELECTING_TARGET_SET;
        if (this.overlay) this.overlay.applyHighlight(parent);
        if (this.picker) this.picker.setTarget(parent);
    }

    moveTargetDown() {
        if (!this.pinTarget) return;
        const root = pinnableRootFor(this.pinTarget);
        if (!root) return;

        // If we remember the user's originally-clicked leaf and it's still a
        // descendant of the current target, walk ONE step toward it — pick
        // the child of the current target that contains the leaf. This
        // preserves the "refine inward toward what I clicked" semantic.
        if (this._clickedLeaf
            && this._clickedLeaf !== this.pinTarget
            && this.pinTarget.contains(this._clickedLeaf)) {
            const children = this.pinTarget.children;
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                if (c === this._clickedLeaf || c.contains(this._clickedLeaf)) {
                    if (isPinnable(c)) {
                        this.pinTarget = c;
                        this.modeState = STATE_SELECTING_TARGET_SET;
                        if (this.overlay) this.overlay.applyHighlight(c);
                        if (this.picker) this.picker.setTarget(c);
                        return;
                    }
                    break;
                }
            }
        }

        // Fallback: walk to the first pinnable descendant in document order.
        const nextEl = _firstPinnableDescendant(this.pinTarget, root);
        if (nextEl) {
            this.pinTarget = nextEl;
            this.modeState = STATE_SELECTING_TARGET_SET;
            if (this.overlay) this.overlay.applyHighlight(nextEl);
            if (this.picker) this.picker.setTarget(nextEl);
        }
    }

    confirmCurrentTarget() {
        if (!this.pinTarget) return;
        const root = pinnableRootFor(this.pinTarget);
        if (!root) return;
        const descriptor = printPinPath(this.pinTarget, root.id);
        if (!descriptor) return;
        this.pin(descriptor);
        this.exitSelectionMode();
    }

    onIneligibleTap() {
        const btn = document.getElementById('pin-mode-btn');
        if (btn) {
            btn.classList.remove('pulse');
            // reflow to restart the animation
            void btn.offsetWidth;
            btn.classList.add('pulse');
            setTimeout(() => btn.classList.remove('pulse'), 700);
        }
        api.showInfo("That section can't be pinned — pick something from the combined stats or column 3.");
    }

    _onKeyNav(dir) {
        // Re-evaluate currently-focused element if we have no pin target yet.
        if (!this.pinTarget) {
            const ae = document.activeElement;
            if (ae && ae !== document.body && isPinnable(ae)) {
                this.setPinTarget(ae);
                return;
            }
            // Fallback: jump to first pinnable element in Column 3.
            for (const rootId of PINNABLE_ROOT_IDS) {
                const root = document.getElementById(rootId);
                if (!root) continue;
                const first = _firstPinnableDescendant(root, root);
                if (first) { this.setPinTarget(first); return; }
            }
            return;
        }
        if (dir === 'up') this.moveTargetUp();
        else if (dir === 'down') this.moveTargetDown();
        else if (dir === 'confirm') this.confirmCurrentTarget();
    }

    _updatePinIconActive(active) {
        const btn = document.getElementById('pin-mode-btn');
        if (!btn) return;
        btn.classList.toggle('active', !!active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    // ------------------------------------------------------------------
    // Pin State mutation
    // ------------------------------------------------------------------

    pin(descriptor) {
        if (!descriptor) return;
        const key = pinPathKey(descriptor);

        // Duplicate detection: flash the existing pinned item's border.
        for (const existing of this.pinState) {
            if (pinPathEquals(existing, descriptor)) {
                this._flashDuplicate(pinPathKey(existing));
                return;
            }
        }

        this.pinState.push(descriptor);
        this._ensureContainer();
        this._ensureMirror(descriptor);
        this._renderPinnedList();
        this._persistPinState();
    }

    unpin(pathKey) {
        const idx = this.pinState.findIndex(d => pinPathKey(d) === pathKey);
        if (idx < 0) return;
        this.pinState.splice(idx, 1);

        const entry = this.mirrors.get(pathKey);
        if (entry) {
            if (entry.observer) { try { entry.observer.disconnect(); } catch (_err) { } }
            if (entry.retryTimer) clearTimeout(entry.retryTimer);
            this.mirrors.delete(pathKey);
        }

        if (this.pinState.length === 0) {
            this._unmountContainer();
        } else {
            this._renderPinnedList();
        }
        this._persistPinState();
    }

    reorderPins(fromIdx, toIdx) {
        if (fromIdx === toIdx) return;
        try {
            this.pinState = reorder(this.pinState, fromIdx, toIdx);
        } catch (_err) { return; }
        this._renderPinnedList();
        this._persistPinState();
    }

    reorderPinBy(idx, direction) {
        const neighbor = direction === 'up' ? idx - 1 : idx + 1;
        if (neighbor < 0 || neighbor >= this.pinState.length) return;
        this.reorderPins(idx, direction === 'up' ? neighbor : neighbor + 1);
    }

    clearAllPins() {
        for (const [key, entry] of this.mirrors) {
            if (entry.observer) { try { entry.observer.disconnect(); } catch (_err) { } }
            if (entry.retryTimer) clearTimeout(entry.retryTimer);
        }
        this.mirrors.clear();
        this.pinState = [];
        this._unmountContainer();
        this._persistPinState();
    }

    /** Replace the entire Pin State (used by preset load and import). */
    setPinState(newPaths) {
        this.clearAllPins();
        for (const descriptor of (newPaths || [])) {
            if (!descriptor) continue;
            this.pinState.push(descriptor);
            this._ensureMirror(descriptor);
        }
        if (this.pinState.length > 0) {
            this._ensureContainer();
            this._renderPinnedList();
        }
        this._persistPinState();
    }

    // ------------------------------------------------------------------
    // Container lifecycle
    // ------------------------------------------------------------------

    _ensureContainer() {
        if (this.container && this.container.isMounted) return;
        if (!this.container) {
            this.container = new PinnedContainer({
                onResize: (pct) => this._persistPanelKey('split_pct', pct),
                onCollapseToggle: (collapsed) => this._persistPanelKey('collapsed', collapsed),
                onFullCollapseToggle: (fc) => this._persistPanelKey('fully_collapsed', fc),
                onClearAll: () => this.clearAllPins(),
                onReorder: (from, to) => this.reorderPins(from, to),
                onUnpin: (pathKey) => this.unpin(pathKey),
                onReorderKey: (idx, dir) => this.reorderPinBy(idx, dir),
            });
        }
        this.container.mount();

        // Mount the preset bar inside the container.
        const presetRoot = this.container.getPresetBarElement();
        if (presetRoot) {
            this.presetBar = new PinnedSavesPresetBar(presetRoot, {
                getPinState: () => this.pinState.slice(),
                setPinState: (paths) => this.setPinState(paths),
            });
        }

        // Apply persisted size/collapse state for this platform.
        const split = this._readPanelKey('split_pct');
        const collapsed = this._readPanelKey('collapsed');
        const fullyCollapsed = this._readPanelKey('fully_collapsed');
        this.container.applySplit(split);
        this.container.setCollapsed(!!collapsed);
        this.container.setFullyCollapsed(!!fullyCollapsed);

        // While selection mode is active and the container is mounted, show
        // the inline banner.
        if (this.modeState !== STATE_IDLE) {
            this.container.setBannerVisible(true);
        }
    }

    _unmountContainer() {
        if (this.container) {
            if (this.presetBar && typeof this.presetBar.destroy === 'function') {
                this.presetBar.destroy();
            }
            this.container.unmount();
            this.container = null;
            this.presetBar = null;
        }
    }

    _renderPinnedList() {
        if (!this.container || !this.container.isMounted) return;

        const entries = this.pinState.map((descriptor) => {
            const key = pinPathKey(descriptor);
            const mirror = this.mirrors.get(key);
            const unresolved = !mirror || !mirror.source || !mirror.mirrorRoot;
            let label = '';
            if (mirror && mirror.source) {
                const aria = mirror.source.getAttribute && mirror.source.getAttribute('aria-label');
                label = aria || (mirror.source.textContent || '').trim().slice(0, 40) || 'Pinned item';
            }
            return {
                pathKey: key,
                node: mirror && mirror.mirrorRoot ? mirror.mirrorRoot : null,
                unresolved,
                label,
            };
        });

        this.container.renderItems(entries);
    }

    _flashDuplicate(pathKey) {
        if (!this.container || !this.container.isMounted) return;
        const $item = this.container.$el.find(`.pinned-item[data-pin-key="${_cssEscape(pathKey)}"]`);
        if (!$item.length) return;
        $item.addClass('duplicate-flash');
        setTimeout(() => $item.removeClass('duplicate-flash'), 800);
    }

    // ------------------------------------------------------------------
    // Mirror engine
    // ------------------------------------------------------------------

    _ensureMirror(descriptor) {
        const key = pinPathKey(descriptor);
        if (this.mirrors.has(key)) return;

        const entry = {
            descriptor,
            source: null,
            observer: null,
            mirrorRoot: null,
            retryTimer: null,
            retryFailSince: null,
            lastResolvedAt: null,
        };
        this.mirrors.set(key, entry);
        this._resolveAndAttach(key);
    }

    _resolveAndAttach(key) {
        const entry = this.mirrors.get(key);
        if (!entry) return;

        // Always make sure we're watching the Pinnable Roots so we can
        // detect when a source gets replaced by a parent re-render (e.g.
        // activity-info-section re-creates its inner stat rows on every
        // gear change).
        this._ensurePanelRootObserver();

        const source = resolvePinPath(entry.descriptor, entry.descriptor.root);
        if (!source) {
            // Mark stale; schedule a retry.
            entry.source = null;
            entry.mirrorRoot = null;
            entry.retryFailSince = entry.retryFailSince || Date.now();
            this._ensurePanelRootObserver();
            if (!entry.retryTimer) {
                entry.retryTimer = setTimeout(() => {
                    entry.retryTimer = null;
                    this._resolveAndAttach(key);
                }, STALE_RETRY_MS);
            }
            // If we've been failing for too long, drop the observer ref
            // (but keep Pin Path in state).
            if (entry.retryFailSince && (Date.now() - entry.retryFailSince) > STALE_CLEAR_MS) {
                if (entry.observer) { try { entry.observer.disconnect(); } catch (_err) { } entry.observer = null; }
            }
            this._renderPinnedList();
            return;
        }

        // Success path.
        entry.source = source;
        entry.retryFailSince = null;
        entry.lastResolvedAt = Date.now();
        if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }

        // Capture the source's rendered box so the mirror reads the same
        // size regardless of where it gets flexed into the pinned
        // container. Without this, a narrow dropdown source ends up
        // stretched to full container width.
        const srcRect = source.getBoundingClientRect();
        entry.sourceWidth = Math.round(srcRect.width);
        entry.sourceHeight = Math.round(srcRect.height);

        // Initial clone.
        const clone = source.cloneNode(true);
        // Neutralize interactive ids in the clone so they don't collide with
        // the originals.
        _neutralizeCloneIds(clone);
        _applyMirrorSizing(clone, entry.sourceWidth, entry.sourceHeight);
        entry.mirrorRoot = clone;

        // MutationObserver -> rAF queue.
        if (!entry.observer) {
            entry.observer = new MutationObserver(() => {
                if (this._syncing || this._reDispatching) return;
                this._rafQueue.add(key);
                if (!this._rafHandle) {
                    this._rafHandle = requestAnimationFrame(() => this._drainRAF());
                }
            });
            try {
                entry.observer.observe(source, {
                    childList: true,
                    attributes: true,
                    characterData: true,
                    subtree: true,
                });
            } catch (err) {
                console.error('MutationObserver.observe failed:', err);
            }
        } else {
            // re-observe in case the source reference changed
            try { entry.observer.disconnect(); } catch (_err) { }
            entry.observer = new MutationObserver(() => {
                if (this._syncing || this._reDispatching) return;
                this._rafQueue.add(key);
                if (!this._rafHandle) {
                    this._rafHandle = requestAnimationFrame(() => this._drainRAF());
                }
            });
            entry.observer.observe(source, {
                childList: true, attributes: true, characterData: true, subtree: true,
            });
        }

        this._renderPinnedList();
    }

    _drainRAF() {
        this._rafHandle = null;
        const keys = [...this._rafQueue];
        this._rafQueue.clear();
        this._syncing = true;
        try {
            for (const key of keys) {
                const entry = this.mirrors.get(key);
                if (!entry || !entry.source || !entry.mirrorRoot) continue;
                try {
                    // Tree-diff sync: walk mirror and source in parallel,
                    // updating attributes + text node values + appending/
                    // removing children only where they differ. This
                    // preserves the mirror's existing DOM identity (so
                    // scroll positions, input focus, CSS transitions etc.
                    // survive) while propagating any change in the source.
                    _syncSubtree(entry.mirrorRoot, entry.source);

                    // Re-apply sizing in case the source's rect grew/shrunk.
                    // Cheap — we only set inline style when it changes.
                    const r = entry.source.getBoundingClientRect();
                    const w = Math.round(r.width);
                    const h = Math.round(r.height);
                    if (w !== entry.sourceWidth || h !== entry.sourceHeight) {
                        entry.sourceWidth = w;
                        entry.sourceHeight = h;
                        _applyMirrorSizing(entry.mirrorRoot, w, h);
                    }
                } catch (err) {
                    console.error('Mirror sync failed:', err);
                }
            }
        } finally {
            this._syncing = false;
        }
    }

    /** Observe the Pinnable Roots so we can re-resolve stale sources when they reappear. */
    _ensurePanelRootObserver() {
        if (this._panelRootObserver) return;
        const roots = PINNABLE_ROOT_IDS.map(id => document.getElementById(id)).filter(Boolean);
        if (!roots.length) return;
        this._panelRootObserver = new MutationObserver(() => {
            // For every mirror, verify the source is still in the DOM. If it
            // was detached by a parent re-render, force a re-resolve using
            // its Pin Path descriptor so we pick up the new node and
            // re-attach the observer.
            for (const [key, entry] of this.mirrors) {
                const sourceStillLive = entry.source && document.contains(entry.source);
                if (!sourceStillLive) {
                    // Detach the stale observer first so _resolveAndAttach
                    // creates a fresh one on the new node.
                    if (entry.observer) {
                        try { entry.observer.disconnect(); } catch (_err) { }
                        entry.observer = null;
                    }
                    entry.source = null;
                    this._resolveAndAttach(key);
                }
            }
        });
        for (const r of roots) {
            this._panelRootObserver.observe(r, { childList: true, subtree: true });
        }
    }

    // ------------------------------------------------------------------
    // Pinned -> Source event re-dispatch
    // ------------------------------------------------------------------

    _setupReDispatchHandlers() {
        if (this._reDispatchAttached) return;
        this._reDispatchAttached = true;

        const types = ['click', 'change', 'input'];
        for (const type of types) {
            document.addEventListener(type, (e) => this._handleDelegatedEvent(e, type), true);
        }
    }

    _handleDelegatedEvent(e, type) {
        const target = e.target;
        if (!target || target.nodeType !== 1) return;
        const mirror = target.closest && target.closest('.pinned-item-mirror');
        if (!mirror) return;
        const $item = $(mirror).closest('.pinned-item');
        if (!$item.length) return;
        const key = $item.attr('data-pin-key');
        const entry = this.mirrors.get(key);
        if (!entry || !entry.source) {
            api.showInfo('Original element is no longer available.');
            e.preventDefault(); e.stopPropagation();
            return;
        }

        // Find the analog in the source tree by walking up the mirror
        // collecting a DOM position path, then re-playing it against the source.
        const sourceAnalog = _findSourceAnalog(target, mirror, entry.source);
        if (!sourceAnalog) {
            // Click may have been on the mirror root itself — dispatch to source root.
            // Pass the mirror as the visual anchor for any popovers.
            _reDispatchTo(entry.source, type, e, this, mirror);
            e.preventDefault(); e.stopPropagation();
            return;
        }

        // `target` is the actual element under the user's cursor in the
        // mirror — it's the correct visual anchor for any popovers that
        // the source's click handler might trigger.
        _reDispatchTo(sourceAnalog, type, e, this, target);
        e.preventDefault(); e.stopPropagation();
    }

    // ------------------------------------------------------------------
    // Session persistence
    // ------------------------------------------------------------------

    loadFromSession() {
        const stored = this._getConfig(CONFIG_PATH_PIN_STATE);
        if (Array.isArray(stored) && stored.length > 0) {
            this.pinState = stored.slice();
            this._ensureContainer();
            for (const descriptor of this.pinState) {
                this._ensureMirror(descriptor);
            }
            this._renderPinnedList();
            this._setupReDispatchHandlers();
        }
        // Hook up delegated re-dispatch handlers regardless so that later pins
        // work without a reload.
        this._setupReDispatchHandlers();
    }

    _persistPinState() {
        this._persistPath(CONFIG_PATH_PIN_STATE, this.pinState.slice());
    }

    _persistPanelKey(key, value) {
        const platform = _getPlatform();
        const path = `${CONFIG_PATH_PANEL_PREFIX}.${key}_${platform}`;
        this._persistPath(path, value);
    }

    _readPanelKey(key) {
        const platform = _getPlatform();
        const path = `${CONFIG_PATH_PANEL_PREFIX}.${key}_${platform}`;
        const v = this._getConfig(path);
        if (v !== undefined && v !== null) return v;
        if (key === 'split_pct') return DEFAULT_SPLITS[platform] || 20;
        if (key === 'collapsed') return !!DEFAULT_COLLAPSED[platform];
        return undefined;
    }

    _persistPath(path, value) {
        // Update the local store mirror immediately so _getConfig() reflects the change.
        this._setConfigLocal(path, value);

        if (this._persistTimers.has(path)) {
            clearTimeout(this._persistTimers.get(path));
        }
        const t = setTimeout(() => {
            this._persistTimers.delete(path);
            const uuid = store.state.session && store.state.session.uuid;
            if (!uuid) return;
            $.ajax({
                url: `/api/session/${uuid}/config`,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ path, value }),
            }).fail((xhr) => {
                console.error('Failed to persist', path, xhr.responseText);
            });
        }, PERSIST_DEBOUNCE_MS);
        this._persistTimers.set(path, t);
    }

    _setConfig(path, value) {
        this._persistPath(path, value);
    }

    _setConfigLocal(path, value) {
        const parts = path.split('.');
        let obj = store.state;
        for (let i = 0; i < parts.length - 1; i++) {
            if (obj[parts[i]] === undefined || obj[parts[i]] === null) {
                obj[parts[i]] = {};
            }
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    }

    _getConfig(path) {
        const parts = path.split('.');
        let obj = store.state;
        for (const part of parts) {
            if (obj === null || obj === undefined) return undefined;
            obj = obj[part];
        }
        return obj;
    }
}

// ============================================================================
// Helpers
// ============================================================================

function _firstPinnableDescendant(el, root) {
    if (!el || !root) return null;
    if (typeof document.createTreeWalker === 'function') {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (node === el) return NodeFilter.FILTER_SKIP;
                if (!root.contains(node)) return NodeFilter.FILTER_REJECT;
                return isPinnable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            },
        });
        return walker.nextNode();
    }
    // Fallback — depth-first search.
    const stack = [...el.children].reverse();
    while (stack.length) {
        const n = stack.pop();
        if (isPinnable(n)) return n;
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return null;
}

function _syncAttrs(target, source) {
    if (!target || !source || target.nodeType !== 1 || source.nodeType !== 1) return;
    // Remove attrs on target that aren't on source (except data-pin-* we
    // preserve to keep the mirror identifiable, and `style`/`width`/`height`
    // which we override below for the root mirror sizing).
    const isMirrorRoot = target.hasAttribute && target.hasAttribute('data-pin-mirror-root');
    const targetAttrs = Array.from(target.attributes || []);
    const sourceAttrNames = new Set(Array.from(source.attributes || []).map(a => a.name));
    for (const attr of targetAttrs) {
        const n = attr.name;
        if (sourceAttrNames.has(n)) continue;
        if (n.startsWith('data-pin-')) continue;
        if (n === 'data-mirror-orig-id') continue;
        // Preserve the inline sizing we applied on the mirror root.
        if (isMirrorRoot && (n === 'style' || n === 'width' || n === 'height')) continue;
        target.removeAttribute(n);
    }
    for (const attr of source.attributes) {
        const n = attr.name;
        // Never blindly copy `id` to the mirror — it would create duplicate IDs.
        if (n === 'id') continue;
        // On the mirror root, don't let source `style`/`width`/`height`
        // override our inline sizing that preserves the original rect.
        if (isMirrorRoot && (n === 'style' || n === 'width' || n === 'height')) continue;
        if (target.getAttribute(n) !== attr.value) {
            try { target.setAttribute(n, attr.value); } catch (_err) { /* ignore */ }
        }
    }
}

/**
 * Apply inline width/height to the mirror root so it renders at the same
 * size as the source element, instead of stretching to the pinned
 * container's full width via flex.
 */
function _applyMirrorSizing(el, width, height) {
    if (!el || el.nodeType !== 1) return;
    el.setAttribute('data-pin-mirror-root', '');
    // Use max-width/height so layouts that choose their own size still work.
    el.style.width = `${width}px`;
    el.style.maxWidth = `${width}px`;
    if (height > 0) {
        el.style.minHeight = `${height}px`;
    }
    el.style.flex = '0 0 auto';
    el.style.boxSizing = 'border-box';
}

/**
 * Tree-diff sync: mutate `target` in place so it structurally matches
 * `source` while preserving as much of the existing DOM as possible.
 *
 * Strategy:
 *   - If node types differ, replace entirely.
 *   - For element nodes: sync attributes, then recurse into children by
 *     index. If child count differs, append/remove only the difference.
 *   - For text / comment nodes: update nodeValue only if changed.
 *
 * This avoids wholesale innerHTML replacement so the mirror's live DOM
 * identity is preserved (no duplicate-ID leak, no focus/scroll reset).
 */
function _syncSubtree(target, source) {
    if (!target || !source) return;

    // Different node types → hard replace.
    if (target.nodeType !== source.nodeType) {
        const fresh = source.cloneNode(true);
        _neutralizeCloneIds(fresh);
        target.parentNode && target.parentNode.replaceChild(fresh, target);
        return;
    }

    if (target.nodeType === 3 /* TEXT */ || target.nodeType === 8 /* COMMENT */) {
        if (target.nodeValue !== source.nodeValue) {
            target.nodeValue = source.nodeValue;
        }
        return;
    }

    if (target.nodeType !== 1 /* ELEMENT */) return;

    // Different tag name → hard replace.
    if (target.tagName !== source.tagName) {
        const fresh = source.cloneNode(true);
        _neutralizeCloneIds(fresh);
        target.parentNode && target.parentNode.replaceChild(fresh, target);
        return;
    }

    _syncAttrs(target, source);

    // Recurse into children by index.
    const tChildren = target.childNodes;
    const sChildren = source.childNodes;
    const tLen = tChildren.length;
    const sLen = sChildren.length;
    const shared = Math.min(tLen, sLen);

    for (let i = 0; i < shared; i++) {
        _syncSubtree(tChildren[i], sChildren[i]);
    }

    // Remove surplus target children.
    if (tLen > sLen) {
        for (let i = tLen - 1; i >= sLen; i--) {
            target.removeChild(tChildren[i]);
        }
    }

    // Append missing children from source.
    if (sLen > tLen) {
        for (let i = tLen; i < sLen; i++) {
            const fresh = sChildren[i].cloneNode(true);
            if (fresh.nodeType === 1) _neutralizeCloneIds(fresh);
            target.appendChild(fresh);
        }
    }
}

/** Replace `id` attributes with `data-mirror-id` so the clone doesn't collide with the source. */
function _neutralizeCloneIds(el) {
    if (!el) return;
    const stack = [el];
    while (stack.length) {
        const node = stack.pop();
        if (node.nodeType === 1 && node.id) {
            node.dataset.mirrorOrigId = node.id;
            node.removeAttribute('id');
        }
        if (node.children) {
            for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
        }
    }
}

/** Compute the child-index chain from mirror root to `target`, then resolve that chain against `source`. */
function _findSourceAnalog(target, mirrorRoot, sourceRoot) {
    const chain = [];
    let cur = target;
    while (cur && cur !== mirrorRoot) {
        const parent = cur.parentElement;
        if (!parent) return null;
        const idx = Array.prototype.indexOf.call(parent.children, cur);
        chain.unshift(idx);
        cur = parent;
    }
    let node = sourceRoot;
    for (const idx of chain) {
        if (!node.children || idx < 0 || idx >= node.children.length) return null;
        node = node.children[idx];
    }
    return node;
}

function _reDispatchTo(sourceEl, type, origEvent, controller, mirrorAnchor) {
    controller._reDispatching = true;
    // Expose the mirror anchor globally so any code that calls
    // `showInfoPopover(anchor, ...)` during the synthetic event will
    // render the popover next to the user's cursor (at the mirror
    // position) instead of at the off-screen source.
    if (mirrorAnchor && typeof window !== 'undefined') {
        window.__pinMirrorAnchorOverride = mirrorAnchor;
    }
    try {
        if (type === 'click') {
            // Use a synthetic MouseEvent so button handlers receive the normal shape.
            const ev = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
            });
            sourceEl.dispatchEvent(ev);
        } else if (type === 'change' || type === 'input') {
            // For form controls, also mirror the value before dispatching.
            if (/^(input|select|textarea)$/i.test(sourceEl.tagName)) {
                const origTarget = origEvent.target;
                if (origTarget && /^(input|select|textarea)$/i.test(origTarget.tagName)) {
                    if (origTarget.type === 'checkbox' || origTarget.type === 'radio') {
                        sourceEl.checked = origTarget.checked;
                    } else {
                        sourceEl.value = origTarget.value;
                    }
                }
            }
            const ev = new Event(type, { bubbles: true, cancelable: true });
            sourceEl.dispatchEvent(ev);
        }
    } finally {
        controller._reDispatching = false;
        if (typeof window !== 'undefined') {
            window.__pinMirrorAnchorOverride = null;
        }
    }
}

function _getPlatform() {
    const w = window.innerWidth;
    const portrait = window.matchMedia ? window.matchMedia('(orientation: portrait)').matches : false;
    if (w < 768 && portrait) return 'mobile_portrait';
    if (w < 768) return 'mobile_landscape';
    return 'desktop';
}

function _cssEscape(v) {
    if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(v);
    return String(v).replace(/([^\w-])/g, '\\$1');
}

// ============================================================================
// Singleton bootstrap
// ============================================================================

const pinnedContainerController = new PinnedContainerController();

// Expose globally so main.js can call init() and onPinIconClick().
if (typeof window !== 'undefined') {
    window.pinnedContainerController = pinnedContainerController;
}

export default pinnedContainerController;
