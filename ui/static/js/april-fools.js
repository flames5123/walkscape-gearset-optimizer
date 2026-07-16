/**
 * April Fools Day Feature
 * Activated on April 1st by default, or any day via localStorage toggle.
 * Two independent toggles:
 *   - aprilFoolsAnimationsEnabled: icon chaos animations
 *   - aprilFoolsTextEnabled: name mutations, toasts, title, loading messages
 */

import {
    SILLY_QUALITY_NAMES,
    SILLY_LOADING_MESSAGES,
    FAKE_DROPS,
    TITLE_MUTATIONS,
    SILLY_CONDITIONS,
    SILLY_ACTIVITY_NAMES,
    SILLY_RECIPE_NAMES,
    SILLY_ITEM_NAMES,
    SILLY_CONSUMABLE_NAMES,
    SILLY_PET_NAMES,
} from './april-fools-data.js';
import store from './state.js';

const STORAGE_KEY_ANIMATIONS = 'aprilFoolsAnimationsEnabled';
const STORAGE_KEY_TEXT = 'aprilFoolsTextEnabled';

// ============================================================================
// STATE
// ============================================================================

export function isAprilFoolsEnabled() {
    return isAnimationsEnabled() || isTextEnabled();
}

export function isAnimationsEnabled() {
    const saved = localStorage.getItem(STORAGE_KEY_ANIMATIONS);
    if (saved !== null) return saved === 'true';
    return isAprilFoolsPeriod(); // fallback if somehow not set
}

export function isTextEnabled() {
    const saved = localStorage.getItem(STORAGE_KEY_TEXT);
    if (saved !== null) return saved === 'true';
    return isAprilFoolsPeriod();
}

export function setAprilFoolsEnabled(value) {
    setAnimationsEnabled(value);
    setTextEnabled(value);
}

export function setAnimationsEnabled(value) {
    localStorage.setItem(STORAGE_KEY_ANIMATIONS, value.toString());
    if (value) {
        activateAnimations();
    } else {
        deactivateAnimations();
        if (!isTextEnabled()) document.body.classList.remove('april-fools');
    }
}

export function setTextEnabled(value) {
    localStorage.setItem(STORAGE_KEY_TEXT, value.toString());
    if (value) {
        activateText();
    } else {
        deactivateText();
        if (!isAnimationsEnabled()) document.body.classList.remove('april-fools');
    }
}

// Active April 1–2 by default (auto-disables checkboxes at midnight April 3 local time)
// FAC stays active all of April — users can re-enable manually
function isAprilFoolsPeriod() {
    // Use UTC so the window matches the server-side feature flag window
    const now = new Date();
    const utcMonth = now.getUTCMonth(); // 0-indexed, 3 = April
    const utcDate = now.getUTCDate();
    const utcHour = now.getUTCHours();
    // Window: March 31 10:00 UTC → April 3 00:00 UTC (matches server)
    if (utcMonth === 2 && utcDate === 31 && utcHour >= 10) return true; // Mar 31 10:00+
    if (utcMonth === 3 && utcDate <= 2) return true; // Apr 1–2 all day
    return false;
}

function isAprilFirst() {
    return isAprilFoolsPeriod();
}

// Set defaults during window (only if not already set), force off after window
function _maybeAutoDisable() {
    const now = new Date();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const inPeriod =
        (utcMonth === 2 && utcDate === 31 && now.getUTCHours() >= 10) ||
        (utcMonth === 3 && utcDate <= 2);
    if (inPeriod) {
        // Only set to true if the user has never set a preference (first visit during window)
        if (localStorage.getItem(STORAGE_KEY_ANIMATIONS) === null) {
            localStorage.setItem(STORAGE_KEY_ANIMATIONS, 'true');
        }
        if (localStorage.getItem(STORAGE_KEY_TEXT) === null) {
            localStorage.setItem(STORAGE_KEY_TEXT, 'true');
        }
    } else {
        // Outside window — always force off
        localStorage.setItem(STORAGE_KEY_ANIMATIONS, 'false');
        localStorage.setItem(STORAGE_KEY_TEXT, 'false');
    }
}

// ============================================================================
// ACTIVATE / DEACTIVATE
// ============================================================================

function activateAnimations() {
    document.body.classList.add('april-fools');
    startIconChaos();
    startFleeMouse();
    startStuckLoading();
    startRagdoll();
    startFragmentation();
    startSwap();
    startScalePop();
    startOrbital();
    startPopupSkew();
    startButtonWobble();
    _setupConfetti();
    _showAnimationButtons(true);
    iconObserver.observe(document.body, { subtree: true, childList: true });
}

function deactivateAnimations() {
    stopIconChaos();
    stopFleeMouse();
    stopStuckLoading();
    stopRagdoll();
    stopSwap();
    stopScalePop();
    stopGravityWell();
    stopOrbital();
    stopPopupSkew();
    stopButtonWobble();
    _showAnimationButtons(false);
    iconObserver.disconnect();
}

function _showAnimationButtons(show) {
    const display = show ? '' : 'none';
    ['randomize-gear-btn', 'randomize-activity-btn', 'randomize-animations-col1-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    });
}

function activateText() {
    document.body.classList.add('april-fools');
    startNameMutation();
    startFakeDropNotifications();
    startTitleMutation();
    patchLoadingMessages();
}

function deactivateText() {
    stopNameMutation();
    stopFakeDropNotifications();
    stopTitleMutation();
    unpatchLoadingMessages();
}

// ============================================================================
// ICON CHAOS
// ============================================================================

const REGULAR_ANIMATIONS = ['af-spin', 'af-wobble', 'af-flip-y', 'af-bounce', 'af-drift', 'af-shake', 'af-rotate3d', 'af-break', 'af-drunk', 'af-squish', 'af-vibrate', 'af-upside-down', 'af-tilt-fall', 'af-scale-pop'];
const FILTER_ANIMATIONS = ['af-pulse-hue', 'af-invert-pulse', 'af-blur-pulse', 'af-glow', 'af-dialup', 'af-ghost'];

// Stat icons get a transform + filter combo
const STAT_CHAOS_COMBOS = [
    ['af-spin', 'af-pulse-hue'],
    ['af-wobble', 'af-invert-pulse'],
    ['af-flip-y', 'af-pulse-hue'],
    ['af-bounce', 'af-pulse-hue'],
    ['af-shake', 'af-invert-pulse'],
    ['af-drift', 'af-pulse-hue'],
    ['af-spin', 'af-invert-pulse'],
    ['af-wobble', 'af-pulse-hue'],
    ['af-rotate3d', 'af-pulse-hue'],
    ['af-break', 'af-invert-pulse'],
    ['af-glow', 'af-pulse-hue'],
    ['af-drunk', 'af-pulse-hue'],
    ['af-squish', 'af-invert-pulse'],
    ['af-tilt-fall', 'af-glow'],
    ['af-upside-down', 'af-pulse-hue'],
];

const ALL_AF_CLASSES = [...REGULAR_ANIMATIONS, ...FILTER_ANIMATIONS];

const REGULAR_ICON_SELECTOR = [
    '.item-icon', '.slot-icon', '.skill-icon', '.faction-icon',
    '.activity-icon', '.recipe-icon', '.service-icon', '.location-icon',
    '.drop-card-icon', '.material-icon', '.contributor-icon',
    '.requirement-icon', '.currency-pill-icon', '.currency-steps-icon',
    '.xp-icon', '.steps-icon', '.calculator-skill-icon',
    '.tree-stat-icon', '.travel-stat-icon', '.comparison-stat-icon',
    '.popup-item-icon',
].join(', ');

const STAT_ICON_SELECTOR = '.stat-icon';

function _animateIcon(icon, classes, dur1, dur2) {
    classes.forEach(c => icon.classList.add(c));
    icon.style.setProperty('--af-duration', `${dur1.toFixed(1)}s`);
    if (dur2 !== undefined) icon.style.setProperty('--af-duration2', `${dur2.toFixed(1)}s`);
}

function assignIconAnimations() {
    document.querySelectorAll(REGULAR_ICON_SELECTOR).forEach(icon => {
        if (ALL_AF_CLASSES.some(c => icon.classList.contains(c))) return;
        const pool = Math.random() < 0.4 ? FILTER_ANIMATIONS : REGULAR_ANIMATIONS;
        const anim = pool[Math.floor(Math.random() * pool.length)];
        _animateIcon(icon, [anim], 1.5 + Math.random() * 4);
    });

    document.querySelectorAll(STAT_ICON_SELECTOR).forEach(icon => {
        if (ALL_AF_CLASSES.some(c => icon.classList.contains(c))) return;
        const combo = STAT_CHAOS_COMBOS[Math.floor(Math.random() * STAT_CHAOS_COMBOS.length)];
        // af-rotate3d and af-pulse-hue are too aggressive below 1.5s — enforce a minimum
        const isAggressive = combo[0] === 'af-rotate3d' || combo[1] === 'af-pulse-hue';
        const dur1 = isAggressive ? (1.5 + Math.random() * 2) : (0.6 + Math.random() * 1.5);
        const dur2 = isAggressive ? (2.0 + Math.random() * 2) : (1.2 + Math.random() * 2.5);
        _animateIcon(icon, combo, dur1, dur2);
    });
}

function startIconChaos() { assignIconAnimations(); }

function stopIconChaos() {
    document.querySelectorAll(`${REGULAR_ICON_SELECTOR}, ${STAT_ICON_SELECTOR}`).forEach(el => {
        ALL_AF_CLASSES.forEach(c => el.classList.remove(c));
        el.style.removeProperty('--af-duration');
        el.style.removeProperty('--af-duration2');
    });
}

const iconObserver = new MutationObserver(() => {
    if (!isAnimationsEnabled()) return;
    clearTimeout(iconObserver._t);
    iconObserver._t = setTimeout(() => {
        assignIconAnimations();
        // Re-apply flee class to any new icons
        document.querySelectorAll(FLEE_SELECTOR).forEach(el => el.classList.add('af-flee'));
    }, 150);
});

// ============================================================================
// FLEE MOUSE
// ============================================================================

const FLEE_SELECTOR = '.gear-slot .slot-icon, .gear-slot .item-icon';
let _fleeHandler = null;

function _onMouseMove(e) {
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX == null) return;

    // Gentle nudge — only ragdoll clones, not the real icons
    _bounceRagdollsFrom(clientX, clientY, 3);
}

function startFleeMouse() {
    document.querySelectorAll(FLEE_SELECTOR).forEach(el => el.classList.add('af-flee'));
    _fleeHandler = _onMouseMove;
    document.addEventListener('mousemove', _fleeHandler, { passive: true });
    document.addEventListener('touchmove', _fleeHandler, { passive: true });
}

function stopFleeMouse() {
    if (_fleeHandler) {
        document.removeEventListener('mousemove', _fleeHandler);
        document.removeEventListener('touchmove', _fleeHandler);
        _fleeHandler = null;
    }
    document.querySelectorAll(FLEE_SELECTOR).forEach(el => {
        el.classList.remove('af-flee');
        el.style.transform = '';
    });
}

// ============================================================================
// STUCK LOADING
// ============================================================================

const _stuckTimers = [];

function startStuckLoading() {
    // Pick ~15% of regular icons and wrap them with a stuck spinner after a random delay
    const candidates = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)];
    const picks = candidates.filter(() => Math.random() < 0.15);
    picks.forEach(icon => {
        const delay = 3000 + Math.random() * 12000;
        const t = setTimeout(() => _applyStuck(icon), delay);
        _stuckTimers.push(t);
    });
}

function _applyStuck(icon) {
    if (!isAnimationsEnabled()) return;
    if (icon.closest('.af-stuck-wrapper')) return; // already wrapped
    const wrapper = document.createElement('span');
    wrapper.className = 'af-stuck-wrapper';
    icon.parentNode.insertBefore(wrapper, icon);
    wrapper.appendChild(icon);
    const spinner = document.createElement('span');
    spinner.className = 'af-stuck-spinner';
    wrapper.appendChild(spinner);
    // Un-stick after 4–10s
    const t = setTimeout(() => _removeStuck(wrapper, icon), 4000 + Math.random() * 6000);
    _stuckTimers.push(t);
}

function _removeStuck(wrapper, icon) {
    if (!wrapper.parentNode) return;
    wrapper.parentNode.insertBefore(icon, wrapper);
    wrapper.remove();
}

function stopStuckLoading() {
    _stuckTimers.forEach(clearTimeout);
    _stuckTimers.length = 0;
    document.querySelectorAll('.af-stuck-wrapper').forEach(wrapper => {
        const icon = wrapper.querySelector('img, svg');
        if (icon) wrapper.parentNode?.insertBefore(icon, wrapper);
        wrapper.remove();
    });
}

// ============================================================================
// NAME MUTATION
// ============================================================================

// Build quality maps once (keys lowercase)
const QUALITY_MAP = new Map(Object.entries(SILLY_QUALITY_NAMES).map(([k, v]) => [k.toLowerCase(), v]));

// All silly values as a Set for fast "is this already silly?" checks
const ALL_SILLY_VALUES = new Set([
    ...SILLY_ITEM_NAMES.values(),
    ...SILLY_ACTIVITY_NAMES.values(),
    ...SILLY_RECIPE_NAMES.values(),
    ...SILLY_CONSUMABLE_NAMES.values(),
    ...SILLY_PET_NAMES.values(),
    ...Object.values(SILLY_QUALITY_NAMES),
]);

// Combined activity+recipe map for dropdown value spans
const SILLY_ACTIVITY_AND_RECIPE_NAMES = new Map([...SILLY_ACTIVITY_NAMES, ...SILLY_RECIPE_NAMES]);

const NAME_TARGETS = [
    { selector: '.item-name', map: SILLY_ITEM_NAMES },
    { selector: '.activity-name', map: SILLY_ACTIVITY_NAMES },
    { selector: '.recipe-name', map: SILLY_RECIPE_NAMES },
    { selector: '.popup-item-name', map: SILLY_ITEM_NAMES },
    { selector: '.current-item-name', map: SILLY_ITEM_NAMES },
    { selector: '.contributor-name', map: SILLY_ITEM_NAMES },
    // Skill category headers in activity/recipe dropdowns
    { selector: '.skill-name', map: SILLY_ACTIVITY_NAMES },
    // Activity/recipe info section titles
    { selector: '.activity-info-title', map: SILLY_ACTIVITY_NAMES },
    { selector: '.recipe-info-title', map: SILLY_RECIPE_NAMES },
    // Selected activity/recipe name in dropdown button
    { selector: '.dropdown-value > span', map: SILLY_ACTIVITY_AND_RECIPE_NAMES },
    // Sources dropdown (item-row, item-selection-popup, comparison section)
    { selector: '.source-name', map: SILLY_ACTIVITY_AND_RECIPE_NAMES },
    // Crafting odds table quality cells
    { selector: '.quality-cell', map: QUALITY_MAP },
    // Target quality dropdown spans
    { selector: '.target-item span', map: QUALITY_MAP },
    { selector: '.tree-dropdown-item span', map: QUALITY_MAP },
    { selector: '.tree-dropdown-value span', map: QUALITY_MAP },
    { selector: '.target-dropdown-value span', map: QUALITY_MAP },
];

let _mutating = false;

function _sillyText(el, map) {
    // For elements that may contain child spans (like .contributor-name which has .contributor-condition inside),
    // only read the direct text node, not child element text
    let raw;
    if (el.childNodes.length > 0 && el.firstChild.nodeType === Node.TEXT_NODE) {
        raw = el.firstChild.textContent.trim();
    } else {
        raw = el.textContent.trim();
    }
    if (!raw) return;

    if (!el.dataset.afOrig) {
        if (!ALL_SILLY_VALUES.has(raw)) el.dataset.afOrig = raw;
        else return;
    }
    const orig = el.dataset.afOrig;
    const silly = map.get(orig.toLowerCase()) || map.get(orig);
    if (!silly) return;

    if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
        if (el.firstChild.textContent !== silly) el.firstChild.textContent = silly;
    } else {
        if (el.textContent !== silly) el.textContent = silly;
    }
}

function _restoreText(el) {
    if (el.dataset.afOrig) {
        if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
            el.firstChild.textContent = el.dataset.afOrig;
        } else {
            el.textContent = el.dataset.afOrig;
        }
        delete el.dataset.afOrig;
    }
}

// Condition text: "While Mining" → "While punching rocks"
function _mutateConditionText(el) {
    const raw = el.textContent;
    if (!el.dataset.afOrig) {
        if (!el.dataset.afCondMutated) el.dataset.afOrig = raw;
        else return;
    }
    const orig = el.dataset.afOrig;

    const m = orig.match(/^While (doing .+? skills|[A-Za-z ]+?)(\s+in .+)?$/);
    if (!m) return;

    const skillPart = m[1].trim();
    const locationPart = m[2] || '';
    const options = SILLY_CONDITIONS[skillPart];
    if (!options) return;

    const idx = (el.dataset.afIdx !== undefined)
        ? parseInt(el.dataset.afIdx)
        : Math.floor(Math.random() * options.length);
    el.dataset.afIdx = idx;
    el.dataset.afCondMutated = '1';

    const silly = `While ${options[idx % options.length]}${locationPart}`;
    if (el.textContent !== silly) el.textContent = silly;
}

function applyNameMutations() {
    _mutating = true;
    try {
        for (const { selector, map } of NAME_TARGETS) {
            document.querySelectorAll(selector).forEach(el => _sillyText(el, map));
        }
        document.querySelectorAll('.contributor-condition, .stat-condition, .popup-stat-condition').forEach(_mutateConditionText);

        document.querySelectorAll('.item-requirement').forEach(el => {
            const raw = el.textContent.trim();
            if (!el.dataset.afOrig) {
                if (!ALL_SILLY_VALUES.has(raw)) el.dataset.afOrig = raw;
                else return;
            }
            const orig = el.dataset.afOrig;
            const m = orig.match(/^([A-Za-z][A-Za-z ]*?)(\s+\d.*)$/);
            if (!m) return;
            const skillPart = m[1].trim();
            const rest = m[2];
            const silly = SILLY_ACTIVITY_NAMES.get(skillPart.toLowerCase());
            if (silly && el.textContent !== silly + rest) el.textContent = silly + rest;
        });
    } finally {
        _mutating = false;
    }
}

function revertNameMutations() {
    _mutating = true;
    try {
        for (const { selector } of NAME_TARGETS) {
            document.querySelectorAll(selector).forEach(_restoreText);
        }
        document.querySelectorAll('.contributor-condition, .stat-condition, .popup-stat-condition').forEach(el => {
            if (el.dataset.afOrig) { el.textContent = el.dataset.afOrig; delete el.dataset.afOrig; }
            delete el.dataset.afCondMutated;
            delete el.dataset.afIdx;
        });
        document.querySelectorAll('.item-requirement').forEach(el => {
            if (el.dataset.afOrig) { el.textContent = el.dataset.afOrig; delete el.dataset.afOrig; }
        });
    } finally {
        _mutating = false;
    }
}

const nameObserver = new MutationObserver(() => {
    if (_mutating || !isTextEnabled()) return;
    clearTimeout(nameObserver._t);
    nameObserver._t = setTimeout(applyNameMutations, 80);
});

function startNameMutation() {
    applyNameMutations();
    nameObserver.observe(document.body, { subtree: true, childList: true });
}

function stopNameMutation() {
    nameObserver.disconnect();
    revertNameMutations();
}

// ============================================================================
// FAKE DROP NOTIFICATIONS
// ============================================================================

let _dropTimeout = null;

function startFakeDropNotifications() {
    _dropTimeout = setTimeout(showFakeDropNotif, 8000);
}

function stopFakeDropNotifications() {
    if (_dropTimeout) { clearTimeout(_dropTimeout); _dropTimeout = null; }
}

function showFakeDropNotif() {
    if (!isTextEnabled()) return;
    const msg = FAKE_DROPS[Math.floor(Math.random() * FAKE_DROPS.length)];
    if (window.api?.showSuccess) {
        window.api.showSuccess(msg);
    } else {
        const t = document.createElement('div');
        t.className = 'af-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('af-toast-show'), 10);
        setTimeout(() => { t.classList.remove('af-toast-show'); setTimeout(() => t.remove(), 400); }, 4500);
    }
    _dropTimeout = setTimeout(showFakeDropNotif, 20000 + Math.random() * 40000);
}

// ============================================================================
// TITLE MUTATION
// ============================================================================

let _titleInterval = null, _origTitle = '';

function startTitleMutation() {
    _origTitle = document.title;
    let i = 0;
    _titleInterval = setInterval(() => { document.title = TITLE_MUTATIONS[i++ % TITLE_MUTATIONS.length]; }, 10000);
}

function stopTitleMutation() {
    if (_titleInterval) { clearInterval(_titleInterval); _titleInterval = null; }
    if (_origTitle) document.title = _origTitle;
}

// ============================================================================
// LOADING MESSAGE PATCH
// ============================================================================

function patchLoadingMessages() {
    const obs = new MutationObserver(() => {
        const btn = document.querySelector('.optimize-btn');
        if (!btn) return;
        // Check class instead of text — more reliable than matching exact text content
        if (!btn.classList.contains('optimizing')) return;
        // Find the text node or span that holds the button label
        const span = btn.querySelector('span:not(.spinner)') || btn;
        const txt = span.textContent.trim();
        // Don't re-replace if already silly
        if (SILLY_LOADING_MESSAGES.includes(txt)) return;
        const silly = SILLY_LOADING_MESSAGES[Math.floor(Math.random() * SILLY_LOADING_MESSAGES.length)];
        span.textContent = silly;
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window._afLoadingObserver = obs;
}

function unpatchLoadingMessages() {
    window._afLoadingObserver?.disconnect();
    window._afLoadingObserver = null;
}

// ============================================================================
// REROLL ANIMATIONS
// ============================================================================

export function rerollAnimations() {
    stopIconChaos();
    stopRagdoll();
    stopSwap();
    stopScalePop();
    stopOrbital();
    stopPopupSkew();
    stopButtonWobble();
    requestAnimationFrame(() => {
        startIconChaos();
        startRagdoll();
        startSwap();
        startScalePop();
        startOrbital();
        startPopupSkew();
        startButtonWobble();
    });
}

// Expose globally for main.js button handler
window.rerollAprilFoolsAnimations = rerollAnimations;

// ============================================================================
// RAGDOLL PHYSICS
// ============================================================================

const _ragdolls = [];
let _ragdollRaf = null;
let _accelGx = 0, _accelGy = 1; // gravity direction from accelerometer

function _startAccelerometer() {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (!isMobile || typeof DeviceMotionEvent === 'undefined') return;

    const handler = (e) => {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        _accelGx = Math.max(-1, Math.min(1, (a.x || 0) / 9.8));
        _accelGy = Math.max(-1, Math.min(1, -(a.y || 0) / 9.8));
    };
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
            .then(r => {
                if (r === 'granted') {
                    window.addEventListener('devicemotion', handler, { passive: true });
                    window._afAccelHandler = handler;
                }
            })
            .catch(() => { });
    } else {
        window.addEventListener('devicemotion', handler, { passive: true });
        window._afAccelHandler = handler;
    }
}

function _stopAccelerometer() {
    if (window._afAccelHandler) {
        window.removeEventListener('devicemotion', window._afAccelHandler);
        window._afAccelHandler = null;
    }
    _accelGx = 0; _accelGy = 1;
}

function _spawnRagdoll(sourceEl) {
    const rect = sourceEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // ~30% escape their container, ~70% stay inside it
    const escapes = Math.random() < 0.3;

    const clone = sourceEl.cloneNode(true);
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';

    let x, y, bounds;

    if (escapes) {
        // Fixed positioning on body — can roam the full viewport
        clone.className = 'af-ragdoll'; // position: fixed
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        document.body.appendChild(clone);
        x = rect.left;
        y = rect.top;
        bounds = null; // full screen
    } else {
        // Absolute positioning inside the nearest positioned ancestor
        // so it stays visually within its container
        const container = sourceEl.closest('.column-content, .gear-slot-grid, .owned-items-container, .column') || document.body;
        const containerRect = container.getBoundingClientRect();
        // Make container relatively positioned if it isn't already
        const cs = window.getComputedStyle(container);
        if (cs.position === 'static') container.style.position = 'relative';

        clone.className = 'af-ragdoll-contained';
        clone.style.position = 'absolute';
        clone.style.zIndex = '99990';
        clone.style.pointerEvents = 'none';
        // Position relative to container
        x = rect.left - containerRect.left + container.scrollLeft;
        y = rect.top - containerRect.top + container.scrollTop;
        clone.style.left = x + 'px';
        clone.style.top = y + 'px';
        container.appendChild(clone);

        bounds = {
            left: 0,
            top: 0,
            right: containerRect.width - rect.width,
            bottom: containerRect.height - rect.height,
            isContained: true,
            container,
        };
    }

    // Hide the original while its ragdoll is active
    sourceEl.dataset.afRagdollHidden = '1';
    sourceEl.style.visibility = 'hidden';

    const mass = 0.5 + Math.random() * 1.5;
    const bounciness = 0.3 + Math.random() * 0.5;
    const friction = 0.96 + Math.random() * 0.03;
    const angularFriction = 0.92 + Math.random() * 0.06;

    _ragdolls.push({
        el: clone,
        sourceEl,
        x, y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 1.5 - 0.5,
        angle: 0,
        va: (Math.random() - 0.5) * 6,
        mass, bounciness, friction, angularFriction,
        w: rect.width, h: rect.height,
        bounds,
    });
}

function _tickRagdoll() {
    if (!isAnimationsEnabled()) { _ragdollRaf = null; return; }
    const W = window.innerWidth, H = window.innerHeight;
    // Gentle gravity — much slower
    const gx = _accelGx * 0.12;
    const gy = _accelGy * 0.12;

    for (const r of _ragdolls) {
        r.vx = (r.vx + gx / r.mass) * r.friction;
        r.vy = (r.vy + gy / r.mass) * r.friction;
        r.va *= r.angularFriction;
        r.x += r.vx;
        r.y += r.vy;
        r.angle += r.va;

        // Clamp to bounds
        const minX = r.bounds ? r.bounds.left : 0;
        const maxX = r.bounds ? r.bounds.right : W - r.w;
        const minY = r.bounds ? r.bounds.top : 0;
        const maxY = r.bounds ? r.bounds.bottom : H - r.h;

        if (r.x < minX) { r.x = minX; r.vx = Math.abs(r.vx) * r.bounciness; }
        if (r.x > maxX) { r.x = maxX; r.vx = -Math.abs(r.vx) * r.bounciness; }
        if (r.y < minY) { r.y = minY; r.vy = Math.abs(r.vy) * r.bounciness; }
        if (r.y > maxY) { r.y = maxY; r.vy = -Math.abs(r.vy) * r.bounciness; r.va *= 0.7; }

        r.el.style.left = r.x + 'px';
        r.el.style.top = r.y + 'px';
        r.el.style.transform = `rotate(${r.angle}deg)`;
    }
    _ragdollRaf = requestAnimationFrame(_tickRagdoll);
}

function startRagdoll() {
    _startAccelerometer();
    // Only spawn from visible icons (non-zero bounding rect)
    const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)]
        .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
    icons.filter(() => Math.random() < 0.12).forEach(_spawnRagdoll);
    if (_ragdolls.length && !_ragdollRaf) _ragdollRaf = requestAnimationFrame(_tickRagdoll);
}

function stopRagdoll() {
    _stopAccelerometer();
    if (_ragdollRaf) { cancelAnimationFrame(_ragdollRaf); _ragdollRaf = null; }
    _ragdolls.forEach(r => {
        r.el.remove();
        if (r.sourceEl) {
            r.sourceEl.style.visibility = '';
            delete r.sourceEl.dataset.afRagdollHidden;
        }
        // Clean up container position override if we set it
        if (r.bounds?.isContained && r.bounds.container) {
            r.bounds.container.style.position = '';
        }
    });
    _ragdolls.length = 0;
}

// Bounce a ragdoll away from a point (used by flee + gravity well)
function _bounceRagdollsFrom(cx, cy, force = 8) {
    for (const r of _ragdolls) {
        const rx = r.x + r.w / 2, ry = r.y + r.h / 2;
        const dx = rx - cx, dy = ry - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 50) {
            const f = (force * (1 - dist / 50)) / r.mass;
            r.vx += (dx / dist) * f;
            r.vy += (dy / dist) * f;
            r.va += (Math.random() - 0.5) * f * 2;
        }
    }
}

// ============================================================================
// FRAGMENTATION
// ============================================================================

function _fragmentIcon(sourceEl) {
    const rect = sourceEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const col = sourceEl.closest('.column') || sourceEl.closest('.column-content');
    const bounds = col ? col.getBoundingClientRect() : null;
    const pieces = 6 + Math.floor(Math.random() * 6);

    // Hide original
    sourceEl.dataset.afRagdollHidden = '1';
    sourceEl.style.visibility = 'hidden';

    for (let i = 0; i < pieces; i++) {
        const clone = sourceEl.cloneNode(true);
        clone.className = 'af-ragdoll';
        const size = (rect.width / 2) * (0.4 + Math.random() * 0.6);
        const sx = rect.left + rect.width / 2 - size / 2;
        const sy = rect.top + rect.height / 2 - size / 2;
        clone.style.width = size + 'px';
        clone.style.height = size + 'px';
        clone.style.left = sx + 'px';
        clone.style.top = sy + 'px';
        clone.style.opacity = (0.5 + Math.random() * 0.5).toString();
        document.body.appendChild(clone);

        const angle = (i / pieces) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const speed = 1.5 + Math.random() * 3;
        _ragdolls.push({
            el: clone,
            sourceEl: i === 0 ? sourceEl : null, // only first piece restores original
            x: sx, y: sy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            angle: Math.random() * 360,
            va: (Math.random() - 0.5) * 12,
            mass: 0.6 + Math.random() * 0.8,
            bounciness: 0.4 + Math.random() * 0.4,
            friction: 0.96 + Math.random() * 0.03,
            angularFriction: 0.93 + Math.random() * 0.05,
            w: size, h: size,
            bounds,
        });
    }
    if (!_ragdollRaf) _ragdollRaf = requestAnimationFrame(_tickRagdoll);
}

function startFragmentation() {
    // Fragment ~2% of icons
    const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)];
    icons.filter(() => Math.random() < 0.02).forEach(icon => {
        const delay = 1000 + Math.random() * 8000;
        setTimeout(() => { if (isAnimationsEnabled()) _fragmentIcon(icon); }, delay);
    });
}

// ============================================================================
// SWAP — continuous orbit between two icons
// ============================================================================

const _swapPairs = []; // [{a, b, angle, speed, radius, cx, cy, interval}]
let _swapRaf = null;

function _tickSwap() {
    if (!isAnimationsEnabled()) { _swapRaf = null; return; }
    for (const p of _swapPairs) {
        p.angle += p.speed;
        const rA = p.angle;
        const rB = p.angle + Math.PI;
        const ax = p.cx + Math.cos(rA) * p.radius - p.a.offsetWidth / 2;
        const ay = p.cy + Math.sin(rA) * p.radius * 0.5 - p.a.offsetHeight / 2;
        const bx = p.cx + Math.cos(rB) * p.radius - p.b.offsetWidth / 2;
        const by = p.cy + Math.sin(rB) * p.radius * 0.5 - p.b.offsetHeight / 2;
        p.a.style.position = 'fixed';
        p.a.style.left = ax + 'px';
        p.a.style.top = ay + 'px';
        p.a.style.zIndex = '99992';
        p.a.style.pointerEvents = 'none';
        p.b.style.position = 'fixed';
        p.b.style.left = bx + 'px';
        p.b.style.top = by + 'px';
        p.b.style.zIndex = '99992';
        p.b.style.pointerEvents = 'none';
    }
    _swapRaf = requestAnimationFrame(_tickSwap);
}

function startSwap() {
    const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)]
        .filter(el => el.src && el.getBoundingClientRect().width > 0 && !el.dataset.afRagdollHidden);
    if (icons.length < 4) return;

    // Pick 1 pair max
    const shuffled = icons.sort(() => Math.random() - 0.5);
    const pairCount = 1;
    for (let i = 0; i < pairCount; i++) {
        const a = shuffled[i * 2];
        const b = shuffled[i * 2 + 1];
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        const cx = (rA.left + rA.width / 2 + rB.left + rB.width / 2) / 2;
        const cy = (rA.top + rA.height / 2 + rB.top + rB.height / 2) / 2;
        const dx = rA.left - rB.left, dy = rA.top - rB.top;
        const radius = Math.max(20, Math.sqrt(dx * dx + dy * dy) / 2);
        _swapPairs.push({
            a, b,
            angle: Math.atan2(rA.top - cy, rA.left - cx),
            speed: (0.008 + Math.random() * 0.012) * (Math.random() < 0.5 ? 1 : -1),
            radius: Math.min(radius, 80),
            cx, cy,
        });
    }
    if (_swapPairs.length) _swapRaf = requestAnimationFrame(_tickSwap);
}

function stopSwap() {
    if (_swapRaf) { cancelAnimationFrame(_swapRaf); _swapRaf = null; }
    _swapPairs.forEach(p => {
        [p.a, p.b].forEach(el => {
            el.style.removeProperty('position');
            el.style.removeProperty('left');
            el.style.removeProperty('top');
            el.style.removeProperty('z-index');
            el.style.removeProperty('pointer-events');
        });
    });
    _swapPairs.length = 0;
}

// ============================================================================
// SCALE POP
// ============================================================================

let _scalePopInterval = null;

function startScalePop() {
    _scalePopInterval = setInterval(() => {
        if (!isAnimationsEnabled()) return;
        const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)];
        if (!icons.length) return;
        const icon = icons[Math.floor(Math.random() * icons.length)];
        if (icon.classList.contains('af-scale-pop')) return;
        const origDur = icon.style.getPropertyValue('--af-duration');
        icon.classList.add('af-scale-pop');
        icon.style.setProperty('--af-duration', (1.5 + Math.random() * 1.5) + 's');
        setTimeout(() => {
            icon.classList.remove('af-scale-pop');
            if (origDur) icon.style.setProperty('--af-duration', origDur);
            else icon.style.removeProperty('--af-duration');
        }, 2500);
    }, 2000 + Math.random() * 3000);
}

function stopScalePop() {
    if (_scalePopInterval) { clearInterval(_scalePopInterval); _scalePopInterval = null; }
    document.querySelectorAll('.af-scale-pop').forEach(el => el.classList.remove('af-scale-pop'));
}

// ============================================================================
// CONFETTI BURST
// ============================================================================

const CONFETTI_COLORS = ['#ff0080', '#ffcc00', '#00ffcc', '#aa00ff', '#ff6600', '#00aaff', '#ff3333', '#33ff33'];

function _burstConfetti(x, y) {
    const count = 20 + Math.floor(Math.random() * 15);
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'af-confetti';
        const size = 6 + Math.floor(Math.random() * 18); // random sizes 6–24px
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.borderRadius = Math.random() > 0.4 ? '50%' : (Math.random() > 0.5 ? '2px' : '0');
        document.body.appendChild(el);

        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 160;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 100;
        const rot = (Math.random() - 0.5) * 900;
        const dur = 700 + Math.random() * 800;

        el.animate([
            { transform: `translate(0,0) rotate(0deg) scale(1)`, opacity: 1 },
            { transform: `translate(${vx}px, ${vy + 150}px) rotate(${rot}deg) scale(0.3)`, opacity: 0 },
        ], { duration: dur, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' })
            .onfinish = () => el.remove();
    }
}

// ============================================================================
// CLICK EFFECTS
// ============================================================================

function _spawnLightning(x, y) {
    const bolts = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bolts; i++) {
        const el = document.createElement('div');
        el.className = 'af-lightning';
        el.textContent = '⚡';
        const angle = (Math.random() - 0.5) * 120; // degrees
        const dist = 30 + Math.random() * 60;
        const rad = (angle * Math.PI) / 180;
        const tx = Math.cos(rad) * dist;
        const ty = Math.sin(rad) * dist - dist;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        el.animate([
            { transform: `translate(-50%,-50%) scale(0.5) rotate(${angle}deg)`, opacity: 1 },
            { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(1.5) rotate(${angle + 20}deg)`, opacity: 0.9, offset: 0.3 },
            { transform: `translate(calc(-50% + ${tx * 1.5}px), calc(-50% + ${ty * 1.5}px)) scale(0.2) rotate(${angle + 40}deg)`, opacity: 0 },
        ], { duration: 400 + Math.random() * 200, easing: 'ease-out', fill: 'forwards' })
            .onfinish = () => el.remove();
    }
}

function _spawnCoins(x, y) {
    const coins = ['🪙', '💰', '💵', '🤑'];
    const count = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'af-coin';
        el.textContent = coins[Math.floor(Math.random() * coins.length)];
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        const vx = (Math.random() - 0.5) * 120;
        const vy = -(60 + Math.random() * 80);
        const dur = 800 + Math.random() * 600;
        el.animate([
            { transform: `translate(-50%,-50%) scale(1)`, opacity: 1 },
            { transform: `translate(calc(-50% + ${vx * 0.5}px), calc(-50% + ${vy * 0.5}px)) scale(1.2)`, opacity: 1, offset: 0.3 },
            { transform: `translate(calc(-50% + ${vx}px), calc(-50% + ${vy + 120}px)) scale(0.5) rotate(${(Math.random() - 0.5) * 360}deg)`, opacity: 0 },
        ], { duration: dur, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' })
            .onfinish = () => el.remove();
    }
}

function _triggerEarthquake() {
    if (document.body.classList.contains('af-quaking')) return;
    document.body.classList.add('af-quaking');
    setTimeout(() => document.body.classList.remove('af-quaking'), 550);
}

// Click effect registry — each entry: { weight, fn }
const _CLICK_EFFECTS = [
    { weight: 10, fn: (x, y) => _burstConfetti(x, y) },
    { weight: 8, fn: (x, y) => _spawnLightning(x, y) },
    { weight: 6, fn: (x, y) => _spawnCoins(x, y) },
    { weight: 4, fn: () => _triggerEarthquake() },
    { weight: 5, fn: (x, y) => _shatterIconAt(x, y) },
];
const _CLICK_TOTAL_WEIGHT = _CLICK_EFFECTS.reduce((s, e) => s + e.weight, 0);

function _pickClickEffect() {
    let r = Math.random() * _CLICK_TOTAL_WEIGHT;
    for (const e of _CLICK_EFFECTS) { r -= e.weight; if (r <= 0) return e.fn; }
    return _CLICK_EFFECTS[0].fn;
}

function _setupConfetti() {
    let _clickCooldown = false;
    const _fire = (x, y) => {
        if (!isAnimationsEnabled() || _clickCooldown) return;
        _clickCooldown = true;
        setTimeout(() => { _clickCooldown = false; }, 600);
        _pickClickEffect()(x, y);
    };
    document.addEventListener('click', (e) => {
        const onIcon = !!e.target.closest(REGULAR_ICON_SELECTOR.split(', ').map(s => s.trim()).join(','));
        if (!onIcon && Math.random() > 0.1) return;
        _fire(e.clientX, e.clientY);
    });
    document.addEventListener('touchend', (e) => {
        if (Math.random() > 0.1) return;
        const t = e.changedTouches?.[0];
        if (t) _fire(t.clientX, t.clientY);
    }, { passive: true });
}

// ============================================================================
// SHATTER (in-place, stays near origin)
// ============================================================================

function _shatterIconAt(x, y) {
    // Find the nearest visible icon to the click point
    let nearest = null, nearestDist = Infinity;
    document.querySelectorAll(REGULAR_ICON_SELECTOR).forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.sqrt((cx - x) ** 2 + (cy - y) ** 2);
        if (d < nearestDist) { nearestDist = d; nearest = el; }
    });
    if (!nearest || nearestDist > 120) return;
    _shatterIcon(nearest);
}

function _shatterIcon(sourceEl) {
    const rect = sourceEl.getBoundingClientRect();
    if (!rect.width) return;
    const pieces = 8 + Math.floor(Math.random() * 6);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (let i = 0; i < pieces; i++) {
        const el = document.createElement('div');
        el.className = 'af-shatter-piece';
        const size = rect.width * (0.25 + Math.random() * 0.4);
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        el.style.overflow = 'hidden';

        // Clone the icon inside, offset so a different part shows through each piece
        const img = sourceEl.cloneNode(true);
        img.style.position = 'absolute';
        img.style.width = rect.width + 'px';
        img.style.height = rect.height + 'px';
        img.style.left = (-Math.random() * (rect.width - size)) + 'px';
        img.style.top = (-Math.random() * (rect.height - size)) + 'px';
        el.appendChild(img);
        document.body.appendChild(el);

        // Scatter outward but stay close — max 60px from origin
        const angle = (i / pieces) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const dist = 20 + Math.random() * 50;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        const rot = (Math.random() - 0.5) * 180;
        const dur = 500 + Math.random() * 400;

        el.animate([
            { transform: `translate(-50%,-50%) scale(1) rotate(0deg)`, opacity: 1 },
            { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.6) rotate(${rot}deg)`, opacity: 0.8, offset: 0.4 },
            { transform: `translate(calc(-50% + ${tx * 1.2}px), calc(-50% + ${ty * 1.2}px)) scale(0.1) rotate(${rot * 1.5}deg)`, opacity: 0 },
        ], { duration: dur, easing: 'ease-out', fill: 'forwards' })
            .onfinish = () => el.remove();
    }
}

// ============================================================================
// GRAVITY WELL
// ============================================================================

let _wellRaf = null;
let _wellX = -9999, _wellY = -9999;
let _wellActive = false;
const _wellParticles = []; // {el, x, y, vx, vy}

function _onWellMouseMove(e) {
    _wellX = e.clientX ?? e.touches?.[0]?.clientX ?? _wellX;
    _wellY = e.clientY ?? e.touches?.[0]?.clientY ?? _wellY;
}

function _tickWell() {
    if (!isAnimationsEnabled()) { _wellRaf = null; return; }
    for (const p of _wellParticles) {
        const dx = _wellX - p.x, dy = _wellY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Pull toward cursor, stronger when closer (but not too close)
        const strength = Math.min(2.5, 80 / (dist + 10));
        p.vx = (p.vx + (dx / dist) * strength) * 0.92;
        p.vy = (p.vy + (dy / dist) * strength) * 0.92;
        p.x += p.vx;
        p.y += p.vy;
        // Bounce off walls
        const W = window.innerWidth, H = window.innerHeight;
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) * 0.5; }
        if (p.x > W) { p.x = W; p.vx = -Math.abs(p.vx) * 0.5; }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy) * 0.5; }
        if (p.y > H) { p.y = H; p.vy = -Math.abs(p.vy) * 0.5; }
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';
    }
    _wellRaf = requestAnimationFrame(_tickWell);
}

function startGravityWell() {
    // Clone ~15% of icons as free-floating well particles
    const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)];
    icons.filter(() => Math.random() < 0.15).forEach(icon => {
        const rect = icon.getBoundingClientRect();
        if (!rect.width) return;
        const clone = icon.cloneNode(true);
        clone.className = 'af-ragdoll'; // reuse fixed positioning
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        document.body.appendChild(clone);
        _wellParticles.push({
            el: clone,
            x: rect.left, y: rect.top,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
        });
    });
    document.addEventListener('mousemove', _onWellMouseMove, { passive: true });
    document.addEventListener('touchmove', _onWellMouseMove, { passive: true });
    if (_wellParticles.length) _wellRaf = requestAnimationFrame(_tickWell);
}

function stopGravityWell() {
    if (_wellRaf) { cancelAnimationFrame(_wellRaf); _wellRaf = null; }
    document.removeEventListener('mousemove', _onWellMouseMove);
    document.removeEventListener('touchmove', _onWellMouseMove);
    _wellParticles.forEach(p => p.el.remove());
    _wellParticles.length = 0;
}

// ============================================================================
// ORBITAL — elliptical orbit around cursor, 1 orbit per 2 seconds
// ============================================================================

let _orbitalRaf = null;
let _orbitalEl = null;
// Cursor position (orbit center) — smoothly tracked
let _orbitalTargetX = window.innerWidth / 2, _orbitalTargetY = window.innerHeight / 2;
let _orbitalCenterX = window.innerWidth / 2, _orbitalCenterY = window.innerHeight / 2;
let _orbitalAngle = 0;
let _orbitalStartTime = 0;
// Ellipse axes — randomized per session
let _orbitalRadiusX = 0, _orbitalRadiusY = 0;

function _onOrbitalMouseMove(e) {
    _orbitalTargetX = e.clientX ?? e.touches?.[0]?.clientX ?? _orbitalTargetX;
    _orbitalTargetY = e.clientY ?? e.touches?.[0]?.clientY ?? _orbitalTargetY;
}

function _tickOrbital(ts) {
    if (!isAnimationsEnabled() || !_orbitalEl) { _orbitalRaf = null; return; }

    // Smoothly move orbit center toward cursor (lag = feels natural)
    _orbitalCenterX += (_orbitalTargetX - _orbitalCenterX) * 0.06;
    _orbitalCenterY += (_orbitalTargetY - _orbitalCenterY) * 0.06;

    // 1 full orbit every 2000ms
    const elapsed = ts - _orbitalStartTime;
    _orbitalAngle = (elapsed / 2000) * Math.PI * 2;

    const x = _orbitalCenterX + Math.cos(_orbitalAngle) * _orbitalRadiusX;
    const y = _orbitalCenterY + Math.sin(_orbitalAngle) * _orbitalRadiusY;

    const size = parseInt(_orbitalEl.style.width) || 24;
    _orbitalEl.style.left = (x - size / 2) + 'px';
    _orbitalEl.style.top = (y - size / 2) + 'px';

    // Subtle depth scale as it goes "behind" (bottom of ellipse = smaller)
    const scale = 0.75 + (Math.sin(_orbitalAngle) + 1) * 0.125; // 0.75–1.0
    _orbitalEl.style.transform = `scale(${scale.toFixed(3)})`;

    _orbitalRaf = requestAnimationFrame(_tickOrbital);
}

function startOrbital() {
    const icons = [...document.querySelectorAll(REGULAR_ICON_SELECTOR)]
        .filter(el => el.getBoundingClientRect().width > 0);
    if (!icons.length) return;
    const src = icons[Math.floor(Math.random() * icons.length)];
    _orbitalEl = src.cloneNode(true);
    _orbitalEl.className = 'af-orbital';
    _orbitalEl.style.width = '24px';
    _orbitalEl.style.height = '24px';
    document.body.appendChild(_orbitalEl);
    // Ellipse: wider than tall (classic orbit shape), randomized a bit
    _orbitalRadiusX = 70 + Math.random() * 40;  // 70–110px
    _orbitalRadiusY = 30 + Math.random() * 20;  // 30–50px
    _orbitalStartTime = performance.now();
    document.addEventListener('mousemove', _onOrbitalMouseMove, { passive: true });
    document.addEventListener('touchmove', _onOrbitalMouseMove, { passive: true });
    _orbitalRaf = requestAnimationFrame(_tickOrbital);
}

function stopOrbital() {
    if (_orbitalRaf) { cancelAnimationFrame(_orbitalRaf); _orbitalRaf = null; }
    document.removeEventListener('mousemove', _onOrbitalMouseMove);
    document.removeEventListener('touchmove', _onOrbitalMouseMove);
    if (_orbitalEl) { _orbitalEl.remove(); _orbitalEl = null; }
}

// ============================================================================
// POPUP SKEW — slot popup modal slowly tilts after opening
// ============================================================================

// Selectors for the inner modal element inside each overlay type
const MODAL_OVERLAY_SELECTOR = '.modal-overlay, .item-selection-modal-overlay';

// Dropdown panels that can also tilt
const DROPDOWN_TILT_SELECTOR = [
    '.activity-dropdown', '.recipe-dropdown',
    '.tree-dropdown-panel', '.source-dropdown-list',
    '.material-source-dropdown', '.gear-set-dropdown',
].join(', ');

function _applyModalTilt(overlayEl) {
    if (Math.random() > 0.2) return; // 1 in 5
    const modal = overlayEl.querySelector('.modal');
    if (!modal || modal.dataset.afTilting) return;
    modal.dataset.afTilting = '1';
    modal.classList.add('af-modal-tilt');
    modal.style.transform = 'rotate(0deg)';
    requestAnimationFrame(() => {
        const deg = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 9); // 1–10°
        modal.style.transform = `rotate(${deg.toFixed(1)}deg)`;
        modal.style.transformOrigin = 'center top';
    });
}

function _applyDropdownTilt(el) {
    if (el.dataset.afTilting) return;
    if (Math.random() > 0.2) return; // 1 in 5
    el.dataset.afTilting = '1';

    const deg = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10);
    // CW (positive) = swings right → pivot top-left
    // CCW (negative) = swings left → pivot top-right
    const origin = deg > 0 ? 'top left' : 'top right';

    el.style.transformOrigin = origin;
    el.style.setProperty('--af-tilt', `${deg.toFixed(1)}deg`);
    el.classList.remove('af-pendulum');
    requestAnimationFrame(() => el.classList.add('af-pendulum'));
}

function _removeDropdownTilt(el) {
    el.classList.remove('af-modal-tilt', 'af-pendulum');
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.removeProperty('--af-tilt');
    delete el.dataset.afTilting;
}

function _removeModalTilt(overlayEl) {
    const modal = overlayEl.querySelector('.modal');
    if (!modal) return;
    modal.classList.remove('af-modal-tilt');
    modal.style.transform = '';
    modal.style.transformOrigin = '';
    delete modal.dataset.afTilting;
}

let _skewObserver = null;

function startPopupSkew() {
    // Apply to any already-open overlays
    document.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach(el => {
        if (el.classList.contains('show')) _applyModalTilt(el);
    });
    // Apply to any already-visible dropdowns
    document.querySelectorAll(DROPDOWN_TILT_SELECTOR).forEach(el => {
        if (window.getComputedStyle(el).display !== 'none') _applyDropdownTilt(el);
    });

    _skewObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type !== 'attributes') continue;
            const el = m.target;

            // Modal overlays — watch for .show class
            if (m.attributeName === 'class' && el.matches?.(MODAL_OVERLAY_SELECTOR)) {
                if (el.classList.contains('show')) {
                    setTimeout(() => _applyModalTilt(el), 50);
                } else {
                    _removeModalTilt(el);
                }
            }

            // Dropdowns — watch for style display changes
            if (m.attributeName === 'style' && el.matches?.(DROPDOWN_TILT_SELECTOR)) {
                const visible = window.getComputedStyle(el).display !== 'none';
                if (visible && !el.dataset.afTilting) {
                    setTimeout(() => _applyDropdownTilt(el), 30);
                } else if (!visible && el.dataset.afTilting) {
                    _removeDropdownTilt(el);
                }
            }
        }
    });
    _skewObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
    });
}

function stopPopupSkew() {
    _skewObserver?.disconnect();
    _skewObserver = null;
    document.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach(el => _removeModalTilt(el));
    document.querySelectorAll(DROPDOWN_TILT_SELECTOR).forEach(el => _removeDropdownTilt(el));
}

// ============================================================================
// SCROLL DRIFT — column content slowly drifts sideways while scrolling
// ============================================================================

let _scrollDriftHandler = null;
let _scrollDriftReset = null;

function startScrollDrift() {
    _scrollDriftHandler = () => {
        if (!isAnimationsEnabled()) return;
        const cols = document.querySelectorAll('.column-content');
        cols.forEach(col => {
            const drift = (Math.random() - 0.5) * 6;
            col.style.transition = 'transform 0.3s ease-out';
            col.style.transform = `translateX(${drift}px)`;
            clearTimeout(col._driftReset);
            col._driftReset = setTimeout(() => {
                col.style.transform = '';
                setTimeout(() => { col.style.transition = ''; }, 350);
            }, 300);
        });
    };
    window.addEventListener('scroll', _scrollDriftHandler, { passive: true });
    // Also trigger on column scroll
    document.querySelectorAll('.column-content').forEach(col => {
        col.addEventListener('scroll', _scrollDriftHandler, { passive: true });
    });
}

function stopScrollDrift() {
    if (_scrollDriftHandler) {
        window.removeEventListener('scroll', _scrollDriftHandler);
        document.querySelectorAll('.column-content').forEach(col => {
            col.removeEventListener('scroll', _scrollDriftHandler);
            col.style.transform = '';
            col.style.transition = '';
        });
        _scrollDriftHandler = null;
    }
}

// ============================================================================
// BUTTON WOBBLE — buttons randomly wobble when hovered
// ============================================================================

let _btnWobbleHandler = null;

function startButtonWobble() {
    _btnWobbleHandler = (e) => {
        if (!isAnimationsEnabled()) return;
        const btn = e.target.closest('button, .optimize-btn, .dash-btn');
        if (!btn || btn.dataset.afWobbling) return;
        if (Math.random() > 0.3) return; // 30% of hovers
        btn.dataset.afWobbling = '1';
        const deg = (Math.random() - 0.5) * 10;
        btn.style.transition = 'transform 0.15s ease-in-out';
        btn.style.transform = `rotate(${deg}deg) scale(${0.95 + Math.random() * 0.1})`;
        setTimeout(() => {
            btn.style.transform = '';
            setTimeout(() => {
                btn.style.transition = '';
                delete btn.dataset.afWobbling;
            }, 200);
        }, 200);
    };
    document.addEventListener('mouseover', _btnWobbleHandler);
}

function stopButtonWobble() {
    if (_btnWobbleHandler) {
        document.removeEventListener('mouseover', _btnWobbleHandler);
        _btnWobbleHandler = null;
    }
    document.querySelectorAll('[data-af-wobbling]').forEach(el => {
        el.style.transform = '';
        el.style.transition = '';
        delete el.dataset.afWobbling;
    });
}

// ============================================================================
// INIT
// ============================================================================

export function initAprilFools() {
    _maybeAutoDisable();
    // Gate behind feature flag — wait for flags to load if not yet available
    const _tryInit = () => {
        if (window._featureFlags && !window._featureFlags.april_fools) return; // not enabled
        if (isAnimationsEnabled()) activateAnimations();
        if (isTextEnabled()) activateText();
    };
    if (window._featureFlags !== undefined) {
        _tryInit();
    } else {
        // Flags not loaded yet — wait for them
        const poll = setInterval(() => {
            if (window._featureFlags !== undefined) {
                clearInterval(poll);
                _tryInit();
            }
        }, 100);
        // Give up after 5s (fall back to date-based check only)
        setTimeout(() => {
            clearInterval(poll);
            _tryInit();
        }, 5000);
    }

    // Re-run after session loads in case session config has preferences
    window.addEventListener('session-loaded', () => {
        if (window._featureFlags && !window._featureFlags.april_fools) return;
        // Only activate if localStorage says enabled (already set by _maybeAutoDisable)
        if (isAnimationsEnabled() && !document.body.classList.contains('april-fools')) activateAnimations();
        if (isTextEnabled()) activateText();
    }, { once: true });
}
