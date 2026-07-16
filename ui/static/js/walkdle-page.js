/**
 * walkdle-page.js
 *
 * Walkdle "Guess the Item" daily-puzzle overlay. Inline-styled inner content;
 * outer positioning comes from the `.walkdle-page` CSS rule, which sits BELOW
 * the header (top:var(--header-height)) so the nav/header bar stays visible.
 * Hash-routed (#walkdle) via main.js's handleHashChange chokepoint.
 *
 * Features:
 *   - Daily target via the pure engine (pickDailyTarget), per UTC date.
 *   - Prev / Today / Next date navigation + a calendar that colours each day
 *     green (solved) / red (failed) / neutral (not played), from play history.
 *   - Crafted items are guessable at every quality (Normal..Eternal); the
 *     autocomplete shows "Name (Quality)".
 *   - Progress persisted to GET/POST /api/walkdle/attempt by session UUID.
 */

import {
    WALKDLE_COLUMNS,
    compareGuess,
    pickDailyTarget,
    pickDailyTargetStable,
    pickTargetForSeed,
    isValidSeed,
    validSeedWords,
    randomSeed,
    sanitizeSeed,
    utcDateString,
    dailyNumber,
    buildShareString,
    buildScoredleString,
    buildSmartFilter,
    displayName,
    addDays,
    clampDate,
    WALKDLE_START_DATE,
} from './walkdle-engine.js';
import { parseWalkdleQuery } from './utils/walkdle-query.js';
import { wireInfoIcons } from './info-popover.js';

const MODE = 'guess_item';
const MAX_GUESSES = 8;

const STATE_COLORS = {
    green: '#4caf50',
    yellow: '#c9a227',
    red: '#4e545c',
    blue: '#2563c9',
    absent: '#3a3f47',
};

// High-contrast (colorblind-friendly) palette: orange=correct, light blue=
// partial, gray=wrong. Ordinal direction cells stay solid blue (arrow-marked).
const STATE_COLORS_HC = {
    green: '#e67e22',
    yellow: '#4fa8e0',
    red: '#4e545c',
    blue: '#2563c9',
    absent: '#3a3f47',
};

// Crafted-quality maps to a rarity tier for colouring (same mapping the gear
// preview / crafting-tree summary use). Used to colour autocomplete rows by
// rarity background and give icons the canonical 4-direction rarity outline.
const QUALITY_TO_RARITY = {
    normal: 'common', good: 'uncommon', great: 'rare',
    excellent: 'epic', perfect: 'legendary', eternal: 'ethereal',
};

function _effectiveRarity(item) {
    if (!item) return 'common';
    if (item.quality) return QUALITY_TO_RARITY[String(item.quality).toLowerCase()] || 'common';
    return String(item.rarity || 'common').toLowerCase();
}

// Parallel tier-name scales (index 0..5). Quality and rarity are the SAME
// underlying tier on two vocabularies (e.g. tier 3 = Excellent = Epic), which
// is exactly what the "Rarity/Quality" hint column shows ("Excellent/Epic").
const TIER_QUALITY_NAMES = ['normal', 'good', 'great', 'excellent', 'perfect', 'eternal'];
const TIER_RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal'];

// Search terms for an item's tier. Crafted items are emitted once per quality
// but all carry the default rarity="common" (their real tier lives in
// `quality`), so feeding the raw `it.rarity` into the search haystack made a
// "common" query match every crafted quality variant. Derive both parallel
// tier names from the unified `tier_index` instead so a tier search matches the
// displayed "Quality/Rarity" label and actually narrows the list.
function _tierTerms(item) {
    if (!item) return '';
    const i = item.tier_index;
    if (typeof i === 'number' && i >= 0 && i < TIER_QUALITY_NAMES.length) {
        return `${TIER_QUALITY_NAMES[i]} ${TIER_RARITY_NAMES[i]}`;
    }
    // Fallback for items without a unified tier index: keep whatever tier text
    // they carry (quality for crafts, rarity for loot).
    return `${item.quality || ''} ${item.rarity || ''}`;
}

function _rarityIconFilter(rar) {
    const c = `var(--rarity-${rar}-border)`;
    return `filter:drop-shadow(1px 0 0 ${c}) drop-shadow(-1px 0 0 ${c}) drop-shadow(0 1px 0 ${c}) drop-shadow(0 -1px 0 ${c});`;
}

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _capitalize(s) {
    s = String(s == null ? '' : s);
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

export class WalkdlePage {
    constructor(selector) {
        this._selector = selector;
        this._el = document.querySelector(selector);
        this._open = false;
        this._closeTimer = null;
        this._selectedGuessId = null;
        this._catalogLoaded = false;
        this._loading = false;
        this._items = [];
        this._byId = {};
        this._date = utcDateString();
        this._seed = null;  // null = daily mode; string = random/seed mode
        this._target = null;
        this._guesses = [];
        this._solved = false;
        this._failed = false;
        this._calendarOpen = false;
        this._helpOpen = false;
        this._calendarMonth = this._date.slice(0, 7);  // YYYY-MM being viewed
        this._historyMap = null;  // date -> {solved, failed}
        this._archiveOpen = false;
        this._archiveJustOpened = false;   // one-shot: play the slide-down on next render
        this._calendarJustOpened = false;  // one-shot: play the calendar slide-down
        this._suppressGuessFocus = false;  // one-shot: skip guess-box autofocus (mobile keyboard)
        this._archiveFilter = 'all';   // all | solved | unsolved
        this._seedHistoryMap = null;   // seed word -> {solved, failed, guesses, mode}
        this._flipGuessId = null;  // guess id to play the flip reveal on (one-shot)
        this._revealPending = false;  // defer end-state UI until the flip finishes
        this._lastQuery = '';         // current raw search text typed
        this._lastGuessQuery = '';    // raw query that produced the most recent guess
        // Advanced filters are opt-in PER GAME. `_advancedEnabled` is the live
        // checkbox (toggleable, persisted per game); `_easyMode` is sticky —
        // once the player confirms enabling advanced filters for a game it stays
        // true (so the solve is flagged Easy in share/scoreboard/calendar) even
        // if they later uncheck the box. Both default off (Hard) every game.
        this._advancedEnabled = false;
        this._easyMode = false;
        // `_statsUsed` is the sticky per-game Normal-mode flag: set true once the
        // Show-stats assist is on while the game is in progress. Resolved mode is
        // easy (advanced filters) > normal (stats used) > hard (neither).
        this._statsUsed = false;
        // Show stats is OFF on every new puzzle (it is the Normal-mode assist,
        // not a persisted global preference) and resets per game load.
        this._showStats = false;
        this._highContrast = (typeof localStorage !== 'undefined'
            && localStorage.getItem('walkdle_high_contrast') === '1');
        // Default ON: share output includes the Scoredle narrowing counts.
        this._includeScoredle = !(typeof localStorage !== 'undefined'
            && localStorage.getItem('walkdle_include_scoredle') === '0');

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                if (this._helpOpen) { this._helpOpen = false; this._render(); return; }
                if (this._calendarOpen) { this._calendarOpen = false; this._render(); return; }
                window.location.hash = '';
            }
        });

        // Refresh the scoreboard whenever the tab is re-focused while a
        // finished puzzle is open, so returning to a long-lived tab picks up
        // everyone who played since you last looked. Only re-fetches the
        // scoreboard (no full re-render) and only when there's a result shown.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (!this.isOpen()) return;
            if (!(this._solved || this._failed) || this._revealPending) return;
            this._loadScoreboard();
        });
    }

    isOpen() { return this._open; }

    // --- URL day param (persists the selected date across refresh) ----------

    _dateFromUrl() {
        try {
            const v = new URLSearchParams(window.location.search).get('walkdle_day');
            return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        } catch (_e) { return null; }
    }

    _syncUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (this._seed) {
                params.set('walkdle_seed', this._seed);
                params.delete('walkdle_day');
            } else {
                params.set('walkdle_day', this._date);
                params.delete('walkdle_seed');
            }
            const qs = params.toString();
            history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + '#walkdle');
        } catch (_e) { /* ignore */ }
    }

    _seedFromUrl() {
        try {
            const s = sanitizeSeed(new URLSearchParams(window.location.search).get('walkdle_seed'));
            return s || null;
        } catch (_e) { return null; }
    }

    _clearUrlDay() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (!params.has('walkdle_day') && !params.has('walkdle_seed')) return;
            params.delete('walkdle_day');
            params.delete('walkdle_seed');
            const qs = params.toString();
            history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
        } catch (_e) { /* ignore */ }
    }

    open() {
        if (!this._el) this._el = document.querySelector(this._selector);
        if (!this._el) return;
        if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
        this._open = true;
        // Restore the date from the ?walkdle_day= query param so a refresh
        // keeps the day you were on instead of resetting to today.
        const urlSeed = this._seedFromUrl();
        const fromUrl = this._dateFromUrl();
        if (fromUrl) this._date = clampDate(fromUrl);
        let activeSeed = null;
        try { activeSeed = sanitizeSeed(localStorage.getItem('walkdle_random_seed')) || null; } catch (_e) { /* ignore */ }
        // Precedence: explicit ?walkdle_seed > explicit ?walkdle_day > an
        // in-progress random saved in this session > today's daily puzzle.
        this._initialSeed = urlSeed || (fromUrl ? null : activeSeed) || null;
        this._el.classList.remove('closing');
        this._el.classList.add('opening');
        document.body.classList.add('walkdle-open');
        document.getElementById('walkdle-nav-btn')?.classList.add('active');
        this._ensureCatalogThenLoad();
    }

    close() {
        if (!this._el) {
            document.body.classList.remove('walkdle-open');
            return;
        }
        this._open = false;
        this._calendarOpen = false;
        this._clearUrlDay();
        document.getElementById('walkdle-nav-btn')?.classList.remove('active');
        // Check visibility BEFORE removing 'opening' (removing it first reverts
        // to the base display:none and skips the close animation).
        const wasVisible = getComputedStyle(this._el).display !== 'none';
        this._el.classList.remove('opening');
        if (wasVisible) {
            this._el.classList.add('closing');
            this._closeTimer = setTimeout(() => {
                this._el.classList.remove('closing');
                document.body.classList.remove('walkdle-open');
                this._closeTimer = null;
            }, 260);
        } else {
            this._el.classList.remove('closing');
            document.body.classList.remove('walkdle-open');
        }
    }

    async _ensureCatalogThenLoad() {
        if (this._catalogLoaded) {
            if (this._initialSeed) { const s = this._initialSeed; this._initialSeed = null; this._loadRandom(s); }
            else this._loadDate(this._date);
            return;
        }
        if (this._loading) return;
        this._loading = true;
        this._renderLoading();
        try {
            const res = await fetch('/api/walkdle/catalog', { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`catalog ${res.status}`);
            const cat = await res.json();
            this._items = cat.items || [];
            this._byId = {};
            for (const it of this._items) this._byId[it.id] = it;
            this._catalogLoaded = true;
        } catch (err) {
            console.error('[walkdle] catalog load failed', err);
            this._renderError(err);
            this._loading = false;
            return;
        }
        this._loading = false;
        if (this._initialSeed) { const s = this._initialSeed; this._initialSeed = null; this._loadRandom(s); }
        else this._loadDate(this._date);
    }

    async _loadDate(date) {
        this._seed = null;  // daily mode
        this._archiveOpen = false;  // the seeds archive is random-mode only
        this._date = clampDate(date);
        this._calendarMonth = this._date.slice(0, 7);
        this._syncUrl();
        this._guesses = [];
        this._lastGuessQuery = '';
        this._solved = false;
        this._failed = false;
        this._revealPending = false;
        this._advancedEnabled = false;
        this._easyMode = false;
        this._statsUsed = false;
        this._showStats = false;
        // The answer the CURRENT daily seed produces for this date. If a saved
        // attempt pinned a different answer (it was played before the daily
        // algorithm/pool changed), we keep showing the pinned one but offer a
        // "reset to current seed" button.
        const currentSeedTarget = pickDailyTargetStable(this._date, this._items);
        this._currentSeedTarget = currentSeedTarget;
        this._target = currentSeedTarget;
        this._canResetToCurrent = false;

        try {
            const res = await fetch(`/api/walkdle/attempt?date=${encodeURIComponent(this._date)}&mode=${MODE}`, { credentials: 'same-origin' });
            if (res.ok) {
                const a = await res.json();
                const saved = a && a.state ? a.state : null;
                if (saved) {
                    const pinned = this._lookupSaved(saved.target_id);
                    if (pinned) this._target = pinned;
                    this._solved = !!saved.solved;
                    this._failed = !!saved.failed;
                    this._advancedEnabled = !!saved.advanced_enabled;
                    this._easyMode = !!saved.easy_mode;
                    this._statsUsed = !!saved.stats_used;
                    if (Array.isArray(saved.guesses)) {
                        for (const gid of saved.guesses) {
                            const g = this._lookupSaved(gid);
                            if (g && this._target) this._guesses.push(compareGuess(g, this._target));
                        }
                    }
                    // Offer reset only if they engaged (started or finished) AND
                    // the pinned answer differs from the current daily seed.
                    const engaged = (Array.isArray(saved.guesses) && saved.guesses.length > 0)
                        || this._solved || this._failed;
                    if (engaged && currentSeedTarget && this._target
                        && this._target.id !== currentSeedTarget.id) {
                        this._canResetToCurrent = true;
                    }
                }
            }
        } catch (err) {
            console.warn('[walkdle] attempt load failed', err);
        }
        this._render();
    }

    /**
     * Resolve a saved item id to a pool item. Falls back to the item's Normal
     * quality variant so attempts saved before the quality split (which pinned
     * a bare crafted id like `adamant_hatchet`) still render after the pool
     * gained per-quality ids (`adamant_hatchet__normal`).
     */
    _lookupSaved(id) {
        if (!id) return null;
        return this._byId[id] || this._byId[id + '__normal'] || null;
    }

    /**
     * Discard this day's saved attempt and replay it on the CURRENT daily seed.
     * Used by the "reset to current seed" button shown when a saved attempt was
     * played on a now-superseded answer. There is no DELETE endpoint, so we
     * overwrite the saved state with a cleared one.
     */
    _resetToCurrentSeed() {
        if (this._seed) return;  // daily mode only
        if (!window.confirm('Reset this day to the current answer? Your saved guesses for this day will be cleared.')) return;
        this._guesses = [];
        this._solved = false;
        this._failed = false;
        this._revealPending = false;
        this._canResetToCurrent = false;
        this._advancedEnabled = false;
        this._easyMode = false;
        this._statsUsed = false;
        this._showStats = false;
        this._historyMap = null;  // invalidate calendar cache
        this._target = pickDailyTargetStable(this._date, this._items);
        const state = {
            target_id: this._target ? this._target.id : null,
            guesses: [], solved: false, failed: false,
            advanced_enabled: false, easy_mode: false, stats_used: false,
        };
        fetch('/api/walkdle/attempt', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: this._date, mode: MODE, state }),
        }).catch((err) => console.warn('[walkdle] reset persist failed', err));
        this._render();
    }

    async _loadRandom(seed) {
        // Bijection model: only supported words resolve. An unsupported (or
        // not-yet-assigned) word does NOT silently hash to an item — we tell the
        // player and roll a random valid seed instead.
        const requested = sanitizeSeed(seed);
        let invalidMsg = '';
        if (requested && !isValidSeed(requested, this._items)) {
            invalidMsg = `"${requested}" isn't a valid seed word — starting a random one instead.`;
            seed = randomSeed(this._items);
        } else {
            seed = requested || randomSeed(this._items);
        }
        this._seed = seed;
        this._calendarOpen = false;
        this._helpOpen = false;
        this._guesses = [];
        this._lastGuessQuery = '';
        this._solved = false;
        this._failed = false;
        this._revealPending = false;
        this._advancedEnabled = false;
        this._easyMode = false;
        this._statsUsed = false;
        this._showStats = false;
        this._target = pickTargetForSeed(seed, this._items);
        try {
            const res = await fetch(`/api/walkdle/attempt?date=${encodeURIComponent(seed)}&mode=random`, { credentials: 'same-origin' });
            if (res.ok) {
                const a = await res.json();
                const saved = a && a.state ? a.state : null;
                if (saved) {
                    const pinned = this._lookupSaved(saved.target_id);
                    if (pinned) this._target = pinned;
                    this._solved = !!saved.solved;
                    this._failed = !!saved.failed;
                    this._advancedEnabled = !!saved.advanced_enabled;
                    this._easyMode = !!saved.easy_mode;
                    this._statsUsed = !!saved.stats_used;
                    if (Array.isArray(saved.guesses)) {
                        for (const gid of saved.guesses) {
                            const g = this._lookupSaved(gid);
                            if (g && this._target) this._guesses.push(compareGuess(g, this._target));
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[walkdle] random load failed', err);
        }
        // Keep this random active in the session until it's solved/failed.
        try {
            if (this._solved || this._failed) localStorage.removeItem('walkdle_random_seed');
            else localStorage.setItem('walkdle_random_seed', seed);
        } catch (_e) { /* ignore */ }
        this._syncUrl();
        this._render();
        if (invalidMsg) this._toast(invalidMsg);
    }

    _persist() {
        const state = {
            target_id: this._target ? this._target.id : null,
            guesses: this._guesses.map((g) => g.id),
            solved: this._solved,
            failed: this._failed,
            advanced_enabled: this._advancedEnabled,
            easy_mode: this._easyMode,
            stats_used: this._statsUsed,
        };
        this._historyMap = null;  // invalidate calendar cache
        this._seedHistoryMap = null;  // invalidate seed-archive cache
        const inRandom = !!this._seed;
        const dateKey = inRandom ? this._seed : this._date;
        const modeKey = inRandom ? 'random' : MODE;
        if (inRandom) {
            // Drop the active-random pointer once finished so a refresh returns
            // to the daily puzzle; keep it set while still in progress.
            try {
                if (this._solved || this._failed) localStorage.removeItem('walkdle_random_seed');
                else localStorage.setItem('walkdle_random_seed', this._seed);
            } catch (_e) { /* ignore */ }
        }
        fetch('/api/walkdle/attempt', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateKey, mode: modeKey, state }),
        }).catch((err) => console.warn('[walkdle] persist failed', err));
    }

    _submitGuess(itemId) {
        if (this._solved || this._failed) return;
        const item = this._byId[itemId];
        if (!item || !this._target) return;
        if (this._guesses.some((g) => g.id === itemId)) return;
        const result = compareGuess(item, this._target);
        this._guesses.push(result);
        this._flipGuessId = result.id;  // animate this guess's reveal
        const ended = result.solved || this._guesses.length >= MAX_GUESSES;
        if (result.solved) this._solved = true;
        else if (this._guesses.length >= MAX_GUESSES) this._failed = true;
        // Using the Show-stats assist while playing flags the game Normal (sticky).
        if (this._showStats) this._statsUsed = true;
        this._persist();
        if (ended) {
            // Hold the end state (result message + share, hiding the search)
            // until the final guess's staggered flip finishes — otherwise the
            // win/answer is revealed before the cards turn. The end UI then
            // appears together with the confetti.
            this._revealPending = true;
            this._render();  // grid plays the flip; still in "playing" layout
            const flipMs = (WALKDLE_COLUMNS.length - 1) * 500 + 500 + 150;
            setTimeout(() => {
                this._revealPending = false;
                this._render();
                if (this._solved) this._celebrate();
            }, flipMs);
        } else {
            this._render();
        }
    }

    _celebrate() {
        if (!this._open || typeof document === 'undefined') return;
        const colors = ['#4caf50', '#6a1b9a', '#c9a227', '#2563c9', '#c0392b', '#ff4dd2', '#76d275'];
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3000;overflow:hidden;';
        document.body.appendChild(container);
        const vw = window.innerWidth || 360;
        const vh = window.innerHeight || 640;
        const N = 90;
        for (let i = 0; i < N; i++) {
            const fromLeft = (i % 2 === 0);
            const p = document.createElement('div');
            const w = 6 + Math.random() * 8;
            const edge = Math.random() * (vw * 0.12);
            p.style.cssText = `position:absolute;top:-14px;${fromLeft ? 'left' : 'right'}:${edge}px;`
                + `width:${w}px;height:${w * 0.5}px;background:${colors[i % colors.length]};`
                + `border-radius:1px;opacity:0.95;`;
            container.appendChild(p);
            // Rain down from the corner, spraying inward across the screen.
            const dx = (fromLeft ? 1 : -1) * (40 + Math.random() * vw * 0.7);
            const dy = vh + 60;
            const rot = Math.random() * 720 - 360;
            const dur = 2200 + Math.random() * 1600;
            p.animate([
                { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
                { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity: 1, offset: 0.85 },
                { transform: `translate(${dx}px,${dy + 60}px) rotate(${rot}deg)`, opacity: 0 },
            ], { duration: dur, delay: Math.random() * 250, easing: 'cubic-bezier(.2,.6,.4,1)' });
        }
        setTimeout(() => container.remove(), 4400);
    }

    // --- Rendering ----------------------------------------------------------

    _renderLoading() {
        this._el.innerHTML = this._shellHtml('<div style="padding:40px;text-align:center;opacity:.7">Loading Walkdle…</div>');
        this._wireClose();
        this._wireHelp();
    }

    _renderError(err) {
        this._el.innerHTML = this._shellHtml(
            `<div style="padding:40px;text-align:center;color:#e57373">Could not load Walkdle.<br><span style="opacity:.7;font-size:.85em">${_esc(err && err.message)}</span></div>`
        );
        this._wireClose();
        this._wireHelp();
    }

    _shellHtml(inner) {
        const num = dailyNumber(this._date);
        const isToday = this._date === utcDateString();
        const atStart = this._date <= WALKDLE_START_DATE;
        const navBtn = (id, label, disabled, title) =>
            `<button id="${id}" title="${_esc(title)}" ${disabled ? 'disabled' : ''} style="background:var(--bg-secondary,#23272e);border:1px solid var(--border-color,#3a3f47);color:inherit;border-radius:6px;padding:5px 10px;cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '.4' : '1'};font-size:.9rem;">${label}</button>`;
        return `
        <div style="max-width:900px;margin:0 auto;padding:14px 14px 80px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="display:inline-block;width:22px;height:22px;border-radius:5px;background:#4caf50;"></span>
              <h2 style="margin:0;font-size:1.25rem;">Walkdle <span style="opacity:.6;font-weight:400;">${this._seed ? 'Random' : '#' + num}</span></h2>
              <button id="walkdle-help" aria-label="How to play" title="How to play" style="background:var(--bg-secondary,#23272e);border:1px solid var(--border-color,#3a3f47);color:inherit;border-radius:50%;width:24px;height:24px;padding:0;line-height:1;cursor:pointer;font-size:.9rem;font-weight:700;">?</button>
              ${this._seed ? '' : `<span style="opacity:.6;font-size:.85rem;">${_esc(this._date)}</span>`}
            </div>
            <button id="walkdle-close" aria-label="Close" style="background:none;border:none;color:inherit;font-size:1.6rem;cursor:pointer;line-height:1;">&times;</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
            ${this._seed ? `
              <span style="opacity:.7;font-size:.85rem;">Seed:</span>
              <input id="walkdle-seed-input" type="text" maxlength="8" value="${_esc(this._seed)}" placeholder="seed" autocomplete="off" style="width:96px;box-sizing:border-box;padding:5px 8px;border-radius:6px;border:1px solid var(--border-color,#3a3f47);background:var(--bg-secondary,#23272e);color:inherit;font-size:.9rem;">
              ${navBtn('walkdle-seed-go', 'Go', false, 'Load this seed')}
              ${navBtn('walkdle-random-new', '🎲', false, 'New random puzzle')}
              ${navBtn('walkdle-daily', '📅 Daily', false, 'Back to the daily puzzle')}
              <button id="walkdle-archive" title="Browse the random seed archive" style="background:${this._archiveOpen ? 'rgba(74,158,255,.15)' : 'var(--bg-secondary,#23272e)'};border:1px solid ${this._archiveOpen ? '#4a9eff' : 'var(--border-color,#3a3f47)'};color:inherit;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.9rem;transition:border-color .2s ease, background-color .2s ease;">🗂 Seeds</button>
            ` : `
              ${navBtn('walkdle-prev', '◀', atStart, 'Previous day')}
              ${navBtn('walkdle-today', 'Today', isToday, 'Jump to today')}
              ${navBtn('walkdle-next', '▶', isToday, 'Next day')}
              ${navBtn('walkdle-cal', '📅 Calendar', false, 'Open calendar')}
              ${navBtn('walkdle-random', '🎲 Random', false, 'Play a random puzzle')}
              ${this._canResetToCurrent ? navBtn('walkdle-reset-seed', '↺ Reset to current', false, 'This day was played on an older answer. Reset to the current puzzle (clears your saved progress for this day).') : ''}
            `}
          </div>
          ${this._helpOpen ? this._helpHtml() : ''}
          ${this._calendarOpen ? this._calendarHtml() : ''}
          <div id="walkdle-archive-slot"></div>
          ${inner}
        </div>`;
    }

    _render() {
        if (!this._el) return;
        // While the final guess's flip is still animating, keep the "playing"
        // layout (search bar visible, no result message) so the win/answer
        // isn't spoiled before the cards turn. _revealPending clears when the
        // flip completes, then the end state renders alongside the confetti.
        const finished = (this._solved || this._failed) && !this._revealPending;
        const inner = `
            ${this._gridHtml()}
            ${this._guessBarHtml(finished)}
            ${finished ? this._endHtml() : ''}
        `;
        this._el.innerHTML = this._shellHtml(inner);
        this._wireClose();
        this._wireDateNav();
        this._wireHelp();
        if (this._calendarOpen) this._wireCalendar();
        if (this._archiveOpen && this._seed) {
            // Full re-renders (e.g. a guess) blow away the injected panel; put
            // it back (no slide) so the archive stays open across renders.
            // Random mode only — never show the seeds panel on the daily side.
            const slot = this._el.querySelector('#walkdle-archive-slot');
            if (slot) { slot.innerHTML = this._archiveHtml(); this._wireArchive(); }
        }
        if (!finished) this._wireGuessInput();
        wireInfoIcons(this._el);  // (i) popovers: advanced-filters info, etc.
        const shareBtn = this._el.querySelector('#walkdle-share');
        if (shareBtn) shareBtn.addEventListener('click', () => this._share());
        if (shareBtn) this._loadScoreboard();  // re-fetched on every finished render
        const scoredleToggle = this._el.querySelector('#walkdle-include-scoredle');
        if (scoredleToggle) scoredleToggle.addEventListener('change', () => {
            this._includeScoredle = scoredleToggle.checked;
            try { localStorage.setItem('walkdle_include_scoredle', this._includeScoredle ? '1' : '0'); } catch (_e) { /* ignore */ }
        });
        // The flip/slide reveal is a one-shot for the just-submitted guess.
        this._flipGuessId = null;
    }

    _guessBarHtml(finished) {
        if (finished) return '';
        const remaining = MAX_GUESSES - this._guesses.length;
        return `
        <div style="position:relative;margin-bottom:14px;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;margin-bottom:8px;cursor:pointer;opacity:.9;">
            <input type="checkbox" id="walkdle-showstats" ${this._showStats ? 'checked' : ''}> Show stats
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;margin-bottom:8px;margin-left:14px;cursor:pointer;opacity:.9;">
            <input type="checkbox" id="walkdle-advanced" ${this._advancedEnabled ? 'checked' : ''}> Enable advanced filters
            <span class="travel-info-icon" data-info-title="Advanced filters" data-info-html="${this._advancedInfoHtml()}" role="button" tabindex="0" aria-label="About advanced filters" style="font-style:normal;cursor:pointer;">ⓘ</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;margin-bottom:8px;margin-left:14px;cursor:pointer;opacity:.9;">
            <input type="checkbox" id="walkdle-hc" ${this._highContrast ? 'checked' : ''}> High contrast
          </label>
          <div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button id="walkdle-random-item" title="Fill the search with a random item to start from (does not submit)" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border-color,#3a3f47);background:var(--bg-secondary,#23272e);color:inherit;font-size:.82rem;cursor:pointer;">Random item</button>
            ${this._guesses.length ? `
            <button id="walkdle-fill-last" title="Fill the search with your last guess so you can tweak a few letters" style="padding:5px 10px;border-radius:6px;border:1px solid var(--border-color,#3a3f47);background:var(--bg-secondary,#23272e);color:inherit;font-size:.82rem;cursor:pointer;">Fill last guess</button>
            ${this._advancedEnabled ? `<button id="walkdle-smart-filter" title="Turn every clue from your guesses so far into a search filter" style="padding:5px 10px;border-radius:6px;border:1px solid #4caf50;background:var(--bg-secondary,#23272e);color:#4caf50;font-size:.82rem;cursor:pointer;">Make smart filter</button>` : ''}` : ''}
          </div>
          <div style="display:flex;gap:8px;position:relative;">
            <input id="walkdle-input" type="text" autocomplete="off" placeholder="Type an item name… (${remaining} left)"
              style="flex:1;min-width:0;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--border-color,#3a3f47);background:var(--bg-secondary,#23272e);color:inherit;font-size:1rem;">
            <button id="walkdle-guess-btn" style="flex:0 0 auto;padding:0 18px;border-radius:8px;border:none;background:#6a1b9a;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer;">Guess</button>
            <div id="walkdle-suggest" style="position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:10;max-height:240px;overflow-y:auto;background:var(--bg-secondary,#23272e);border:1px solid var(--border-color,#3a3f47);border-radius:8px;display:none;box-shadow:0 6px 16px rgba(0,0,0,0.4);"></div>
          </div>
        </div>`;
    }

    _gridHtml() {
        const cols = WALKDLE_COLUMNS;
        const gridCols = `display:grid;grid-template-columns:repeat(${cols.length},1fr);gap:4px;`;
        const header = `<div style="${gridCols}margin-bottom:4px;">`
            + cols.map((c) => `<div style="font-size:.52rem;text-transform:uppercase;opacity:.6;font-weight:600;text-align:center;">${_esc(c.label)}</div>`).join('')
            + `</div>`;
        const cards = this._guesses.map((g) => this._rowHtml(g)).join('');
        // Always show the column headers (even before the first guess) so the
        // categories are visible up front. Cards are empty until a guess lands.
        // Horizontal scroll on narrow screens so all columns stay aligned.
        return `<div style="overflow-x:auto;padding-bottom:20px;"><div style="min-width:430px;">${header}${cards}</div></div>`;
    }

    _rowHtml(g) {
        const it = this._byId[g.id];
        const rar = _effectiveRarity(it);
        const animate = (g.id === this._flipGuessId);
        const gridCols = `display:grid;grid-template-columns:repeat(${WALKDLE_COLUMNS.length},1fr);gap:3px;`;
        // Row 1: item icon + name.
        const nameRow = `
          <div style="display:flex;align-items:center;gap:5px;padding:1px 2px 2px;">
            ${g.icon ? `<img src="${_esc(g.icon)}" alt="" width="16" height="16" style="${_rarityIconFilter(rar)}" onerror="this.style.display='none'">` : ''}
            <span style="font-size:.78rem;">${_esc(g.name)}</span>
          </div>`;
        // Row 2: the hint cells.
        const colors = this._highContrast ? STATE_COLORS_HC : STATE_COLORS;
        const cells = g.cells.map((cell, ci) => {
            const bg = colors[cell.state] || colors.absent;
            // Capitalize the first letter of every value except keywords.
            const disp = cell.key === 'keywords' ? cell.display : _capitalize(cell.display);
            let dispHtml = _esc(disp);
            // Break the Rarity/Quality value after the slash so it stacks onto
            // two lines and fits the square (e.g. "Excellent/" over "Epic").
            if (cell.key === 'tier') dispHtml = dispHtml.replace('/', '/<br>');
            let content = dispHtml;
            if (cell.kind === 'ordinal' && cell.dir) {
                const arrow = cell.dir === 'up' ? '▲' : '▼';
                const a = `<div style="line-height:1;font-size:.62rem;">${arrow}</div>`;
                const v = `<div style="line-height:1;">${dispHtml}</div>`;
                content = cell.dir === 'up' ? a + v : v + a;
            }
            const cls = animate ? ' class="walkdle-flip-cell"' : '';
            const delay = animate ? `animation-delay:${(ci * 0.5).toFixed(2)}s;` : '';
            return `<div${cls} style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3px 2px;border-radius:5px;background:${bg};color:#fff;font-size:.62rem;text-align:center;${delay}">${content}</div>`;
        }).join('');
        const cardCls = animate ? ' class="walkdle-card-in"' : '';
        return `<div${cardCls} style="margin-bottom:6px;">${nameRow}<div style="${gridCols}">${cells}</div></div>`;
    }

    _endHtml() {
        const msg = this._solved
            ? `<div style="color:#4caf50;font-weight:600;">Solved in ${this._guesses.length}!</div>`
            : `<div style="color:#e57373;font-weight:600;">Out of guesses. It was <b>${_esc(this._target ? displayName(this._target) : '?')}</b>.</div>`;
        return `
        <div style="margin-top:18px;text-align:center;">
          ${msg}
          <label style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:.85rem;cursor:pointer;opacity:.9;">
            <input type="checkbox" id="walkdle-include-scoredle" ${this._includeScoredle ? 'checked' : ''}> Include Scoredle
          </label>
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button id="walkdle-share" style="padding:9px 18px;border-radius:8px;border:none;background:#4caf50;color:#fff;font-size:.95rem;cursor:pointer;">Share result</button>
          </div>
          <div id="walkdle-scoreboard" style="margin-top:16px;"></div>
        </div>`;
    }

    async _loadScoreboard() {
        const el = this._el && this._el.querySelector('#walkdle-scoreboard');
        if (!el) return;
        const key = this._seed ? this._seed : this._date;
        const mode = this._seed ? 'random' : MODE;
        el.innerHTML = '<div style="opacity:.55;font-size:.82rem;">Loading scoreboard…</div>';
        try {
            const res = await fetch(`/api/walkdle/stats?date=${encodeURIComponent(key)}&mode=${mode}`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error('stats ' + res.status);
            el.innerHTML = this._scoreboardHtml(await res.json());
        } catch (_e) {
            el.innerHTML = '';  // hide silently on error
        }
    }

    _scoreboardHtml(s) {
        const total = (s && s.total) || 0;
        if (!total) return '';
        const isRandom = !!this._seed;  // random/seed mode -> not "today"
        const hist = (s && s.histogram) || {};
        const histByMode = {
            hard: (s && s.histogram_hard) || {},
            normal: (s && s.histogram_normal) || {},
            easy: (s && s.histogram_easy) || {},
        };
        const totalByMode = {
            hard: (s && s.total_hard) || 0,
            normal: (s && s.total_normal) || 0,
            easy: (s && s.total_easy) || 0,
        };
        const failedByMode = {
            hard: (s && s.failed_hard) || 0,
            normal: (s && s.failed_normal) || 0,
            easy: (s && s.failed_easy) || 0,
        };
        const myK = this._guesses.length;
        const myMode = this._resolvedMode();
        const modeHist = histByMode[myMode];
        const modeTotal = totalByMode[myMode];
        let betterAll = 0;
        for (const k in hist) { if (Number(k) < myK) betterAll += hist[k]; }
        let betterMode = 0;
        for (let k = 1; k < myK; k++) betterMode += (modeHist[k] || 0);
        let headline;
        if (this._solved) {
            const rankAll = betterAll + 1;
            const rankMode = betterMode + 1;
            const topPct = Math.max(1, Math.round((rankAll / total) * 100));
            const beatPct = Math.round(((total - rankAll) / total) * 100);
            headline = `Solved in <b>${myK}/${MAX_GUESSES}</b> — ranked <b>#${rankAll}</b> out of ${total} overall, <b>#${rankMode}</b> out of ${modeTotal} for ${myMode} mode (top ${topPct}%, ahead of ${beatPct}% of ${isRandom ? 'players' : "today's players"})`;
        } else {
            headline = `${s.solved} of ${total} players solved ${isRandom ? 'this puzzle' : "today's puzzle"}.`;
        }
        // Distribution bars: guesses 1..MAX, plus a "didn't solve" (X) bucket.
        // Each row shows total | hard | normal | easy counts (subsets of total).
        let maxBar = s.failed || 0;
        for (const k in hist) maxBar = Math.max(maxBar, hist[k]);
        maxBar = Math.max(1, maxBar);
        const NUMW = 'flex:0 0 auto;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;';
        // Colour-coded columns (white total / gold hard / silver normal /
        // bronze easy). The same palette colours the stacked bar segments.
        const COL = { total: '#ffffff', hard: '#f4c542', normal: '#c9ccd1', easy: '#cd7f32' };
        const quartet = (t, h, n, e) =>
            `<span style="color:${COL.total};">${t}</span>, `
            + `<span style="color:${COL.hard};">${h}</span>, `
            + `<span style="color:${COL.normal};">${n}</span>, `
            + `<span style="color:${COL.easy};">${e}</span>`;
        const row = (label, count, h, n, e, highlight) => {
            // Single rounded bar per row (both ends equally rounded), sized to
            // the row's total — the prod look. Green for your guess-count row,
            // neutral otherwise. Per-mode counts live in the coloured numbers.
            const pct = Math.round((count / maxBar) * 100);
            const bar = `<div style="height:12px;width:${pct}%;min-width:${count ? 6 : 0}px;background:${highlight ? '#4caf50' : 'var(--border-color,#3a3f47)'};border-radius:6px;"></div>`;
            return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0;font-size:.74rem;${highlight ? 'font-weight:700;' : ''}">
                <span style="width:18px;text-align:right;opacity:.8;">${label}</span>
                <div style="flex:1;display:flex;align-items:center;">${bar}</div>
                <span style="${NUMW}">${quartet(count, h, n, e)}</span>
              </div>`;
        };
        const colHeader = `<div style="display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:.56rem;text-transform:uppercase;letter-spacing:.02em;">
            <span style="width:18px;"></span>
            <div style="flex:1;"></div>
            <span style="${NUMW}">${quartet('total', 'hard', 'normal', 'easy')}</span>
          </div>`;
        const rows = [];
        for (let k = 1; k <= MAX_GUESSES; k++) {
            rows.push(row(String(k), hist[k] || 0, histByMode.hard[k] || 0, histByMode.normal[k] || 0, histByMode.easy[k] || 0, this._solved && k === myK));
        }
        if (s.failed) rows.push(row('X', s.failed, failedByMode.hard, failedByMode.normal, failedByMode.easy, this._failed));
        return `
        <div style="max-width:380px;margin:0 auto;padding:12px 14px;border:1px solid var(--border-color,#3a3f47);border-radius:10px;background:var(--bg-secondary,#23272e);text-align:left;">
          <div style="font-weight:600;font-size:.9rem;margin-bottom:8px;text-align:center;">${isRandom ? "This puzzle's" : "Today's"} scoreboard</div>
          <div style="font-size:.82rem;opacity:.9;margin-bottom:10px;text-align:center;">${headline}</div>
          ${colHeader}
          ${rows.join('')}
          <div style="font-size:.7rem;opacity:.55;margin-top:8px;text-align:center;">Guesses to solve across ${total} players (X = didn't solve). Columns: total, hard, normal, easy.</div>
        </div>`;
    }

    // --- Calendar -----------------------------------------------------------

    _calendarHtml() {
        const [y, m] = this._calendarMonth.split('-').map(Number);
        const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const today = utcDateString();
        const startMonth = WALKDLE_START_DATE.slice(0, 7);
        const todayMonth = today.slice(0, 7);
        const atStartMonth = this._calendarMonth <= startMonth;
        const atTodayMonth = this._calendarMonth >= todayMonth;
        const hist = this._historyMap || {};
        // Honor the player's high-contrast setting: solved uses the HC "correct"
        // colour (orange) and failed the HC "partial" colour (light blue) — the
        // colourblind-safe orange/blue pair — instead of green/red.
        const solvedColor = this._highContrast ? '#e67e22' : '#2f7d32';
        const failedColor = this._highContrast ? '#4fa8e0' : '#c0392b';

        let cells = '';
        for (let i = 0; i < firstDow; i++) cells += '<div></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const future = ds > today;
            const before = ds < WALKDLE_START_DATE;
            const st = hist[ds];
            let bg = 'transparent';
            if (st && st.solved) bg = solvedColor;
            else if (st && st.failed) bg = failedColor;
            // Gold star for a hard solve, silver for a normal solve; none for
            // an easy solve or a fail. The date sits on top in black so it
            // stays readable over the star.
            let starColor = null;
            if (st && st.solved) {
                if (st.mode === 'hard') starColor = '#f4c542';
                else if (st.mode === 'normal') starColor = '#c9ccd1';
            }
            const disabled = future || before;
            const ring = ds === this._date ? 'box-shadow:0 0 0 2px #4caf50;' : '';
            const star = starColor
                ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:2.5rem;line-height:1;color:${starColor};opacity:.95;pointer-events:none;z-index:0;">★</span>`
                : '';
            const dateStyle = starColor ? 'color:#1a1a1a;font-weight:700;' : '';
            cells += `<div class="walkdle-day" data-date="${ds}" style="position:relative;text-align:center;padding:7px 0;border-radius:6px;background:${bg};${ring}cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '.3' : '1'};border:1px solid var(--border-color,#3a3f47);">${star}<span style="position:relative;z-index:1;${dateStyle}">${d}</span></div>`;
        }
        const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
            .map((x) => `<div style="text-align:center;opacity:.5;font-size:.7rem;">${x}</div>`).join('');
        return `
        <div id="walkdle-calendar" style="${this._calendarJustOpened ? 'display:none;' : ''}margin-bottom:14px;padding:12px;border:1px solid var(--border-color,#3a3f47);border-radius:10px;background:var(--bg-secondary,#23272e);max-width:340px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <button id="walkdle-cal-prev" ${atStartMonth ? 'disabled' : ''} style="background:none;border:none;color:inherit;font-size:1.1rem;cursor:${atStartMonth ? 'default' : 'pointer'};opacity:${atStartMonth ? '.3' : '1'};">‹</button>
            <span style="font-weight:600;">${MONTH_NAMES[m - 1]} ${y}</span>
            <button id="walkdle-cal-next" ${atTodayMonth ? 'disabled' : ''} style="background:none;border:none;color:inherit;font-size:1.1rem;cursor:${atTodayMonth ? 'default' : 'pointer'};opacity:${atTodayMonth ? '.3' : '1'};">›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${dow}${cells}</div>
          <div style="display:flex;gap:12px;margin-top:10px;font-size:.72rem;opacity:.8;">
            <span><span style="display:inline-block;width:10px;height:10px;background:${solvedColor};border-radius:2px;"></span> solved</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:${failedColor};border-radius:2px;"></span> failed</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:transparent;border:1px solid #3a3f47;border-radius:2px;"></span> not played</span>
            <span><span style="color:#f4c542;">★</span> hard mode</span>
            <span><span style="color:#c9ccd1;">★</span> normal mode</span>
          </div>
        </div>`;
    }

    async _ensureHistory() {
        if (this._historyMap) return;
        this._historyMap = {};
        try {
            const res = await fetch(`/api/walkdle/history?mode=${MODE}`, { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                for (const d of (data.days || [])) {
                    this._historyMap[d.date] = { solved: d.solved, failed: d.failed, mode: d.mode };
                }
            }
        } catch (err) {
            console.warn('[walkdle] history load failed', err);
        }
    }

    async _toggleCalendar() {
        if (this._calendarOpen) {
            const $ = window.$;
            const finish = () => { this._calendarOpen = false; this._suppressGuessFocus = true; this._render(); };
            const $c = $ ? $('#walkdle-calendar') : null;
            if ($c && $c.length) $c.stop(true, true).slideUp(180, finish);
            else finish();
            return;
        }
        this._archiveOpen = false;   // mutually exclusive with the archive
        this._calendarOpen = true;
        this._calendarJustOpened = true;   // render hidden; slideDown in _wireCalendar
        await this._ensureHistory();
        this._render();
    }

    _wireCalendar() {
        const $ = window.$;
        // Slide down on the first render after opening (rendered display:none).
        if (this._calendarJustOpened) {
            this._calendarJustOpened = false;
            if ($) $('#walkdle-calendar').stop(true, true).slideDown(180);
            else { const c = this._el.querySelector('#walkdle-calendar'); if (c) c.style.display = ''; }
        }
        const prev = this._el.querySelector('#walkdle-cal-prev');
        const next = this._el.querySelector('#walkdle-cal-next');
        if (prev) prev.addEventListener('click', () => { if (!prev.disabled) { this._calendarMonth = this._shiftMonth(-1); this._render(); } });
        if (next) next.addEventListener('click', () => { if (!next.disabled) { this._calendarMonth = this._shiftMonth(1); this._render(); } });
        this._el.querySelectorAll('.walkdle-day').forEach((cell) => {
            const ds = cell.getAttribute('data-date');
            const today = utcDateString();
            if (!ds || ds > today || ds < WALKDLE_START_DATE) return;
            cell.addEventListener('click', () => {
                const finish = () => { this._calendarOpen = false; this._loadDate(ds); };
                const $c = $ ? $('#walkdle-calendar') : null;
                if ($c && $c.length) $c.stop(true, true).slideUp(180, finish);
                else finish();
            });
        });
    }

    // --- Random seed archive ------------------------------------------------

    async _ensureSeedHistory() {
        if (this._seedHistoryMap) return;
        this._seedHistoryMap = {};
        try {
            const res = await fetch('/api/walkdle/history?mode=random', { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                for (const d of (data.days || [])) {
                    // For random mode the "date" key IS the seed word.
                    this._seedHistoryMap[d.date] = {
                        solved: d.solved, failed: d.failed, guesses: d.guesses, mode: d.mode,
                    };
                }
            }
        } catch (err) {
            console.warn('[walkdle] seed history load failed', err);
        }
    }

    async _toggleArchive() {
        const $ = window.$;
        const btn = this._el.querySelector('#walkdle-archive');
        const slot = this._el.querySelector('#walkdle-archive-slot');
        if (this._archiveOpen) {
            // Close: fade the button border back, slide the panel up, drop it.
            this._archiveOpen = false;
            this._setArchiveBtnActive(btn, false);
            const $p = $ ? $('#walkdle-archive-panel') : null;
            if ($p && $p.length) $p.stop(true, true).slideUp(180, () => { if (slot) slot.innerHTML = ''; });
            else if (slot) slot.innerHTML = '';
            return;
        }
        // Open: inject the panel, fade the button to blue, slide the panel down.
        // No full re-render, so the button element persists and its border
        // transition actually animates (like the recipe-info header).
        this._calendarOpen = false;
        await this._ensureSeedHistory();
        this._archiveOpen = true;
        this._setArchiveBtnActive(btn, true);
        if (slot) {
            slot.innerHTML = this._archiveHtml();
            this._wireArchive();
            const $p = $ ? $('#walkdle-archive-panel') : null;
            if ($p && $p.length) $p.hide().slideDown(180);
        }
    }

    // Toggle the Seeds button's selected (blue) look; the button's own
    // transition property fades the border/background in and out.
    _setArchiveBtnActive(btn, active) {
        if (!btn) return;
        btn.style.borderColor = active ? '#4a9eff' : 'var(--border-color,#3a3f47)';
        btn.style.background = active ? 'rgba(74,158,255,.15)' : 'var(--bg-secondary,#23272e)';
    }

    _seedStatus(word) {
        const st = (this._seedHistoryMap || {})[word];
        if (!st) return 'none';
        if (st.solved) return 'solved';
        if (st.failed) return 'failed';
        return 'progress';
    }

    _archiveHtml() {
        // Match the calendar's palette (respects the high-contrast setting).
        const solvedColor = this._highContrast ? '#e67e22' : '#2f7d32';
        const failedColor = this._highContrast ? '#4fa8e0' : '#c0392b';
        const progressColor = '#6b5bd6';  // distinct in both palettes
        const hist = this._seedHistoryMap || {};
        const filter = this._archiveFilter;
        // Every currently-playable seed, alphabetical (never reveals answers).
        const words = validSeedWords(this._items).slice().sort();
        const shown = words.filter((w) => {
            const s = this._seedStatus(w);
            if (filter === 'solved') return s === 'solved';
            if (filter === 'unsolved') return s !== 'solved';
            return true;
        });

        const chip = (w) => {
            const s = this._seedStatus(w);
            const st = hist[w];
            let bg = 'transparent';
            if (s === 'solved') bg = solvedColor;
            else if (s === 'failed') bg = failedColor;
            else if (s === 'progress') bg = progressColor;
            let starColor = null;
            if (s === 'solved') {
                if (st.mode === 'hard') starColor = '#f4c542';
                else if (st.mode === 'normal') starColor = '#c9ccd1';
            }
            const star = starColor
                ? `<span style="position:absolute;top:2px;right:4px;font-size:.8rem;line-height:1;color:${starColor};pointer-events:none;">★</span>`
                : '';
            const textStyle = s === 'none' ? '' : 'color:#fff;font-weight:600;';
            return `<div class="walkdle-seed-chip" data-seed="${_esc(w)}" title="${_esc(w)}" `
                + `style="position:relative;text-align:center;padding:8px 6px;border-radius:6px;background:${bg};`
                + `cursor:pointer;border:1px solid var(--border-color,#3a3f47);overflow:hidden;">`
                + `${star}<span style="${textStyle}">${_esc(w)}</span></div>`;
        };

        const tab = (id, label) => {
            const active = filter === id;
            return `<button class="walkdle-arch-tab" data-filter="${id}" style="padding:5px 12px;border-radius:6px;`
                + `border:1px solid ${active ? '#4caf50' : 'var(--border-color,#3a3f47)'};`
                + `background:${active ? 'rgba(76,175,80,.15)' : 'var(--bg-secondary,#23272e)'};`
                + `color:inherit;cursor:pointer;font-size:.82rem;">${label}</button>`;
        };

        const grid = shown.length
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;`
                + `max-height:52vh;overflow-y:auto;padding-right:4px;">${shown.map(chip).join('')}</div>`
            : `<div style="padding:24px;text-align:center;opacity:.6;font-size:.85rem;">No seeds match this filter yet.</div>`;

        const dot = (c) => `<span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px;"></span>`;
        return `
        <div id="walkdle-archive-panel" style="margin-bottom:14px;padding:12px 14px;border:1px solid var(--border-color,#3a3f47);border-radius:10px;background:var(--bg-secondary,#23272e);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:.95rem;">Random seed archive <span style="opacity:.6;font-weight:400;">(${shown.length}/${words.length})</span></span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${tab('all', 'All')}
              ${tab('solved', 'Solved')}
              ${tab('unsolved', 'Unsolved only')}
            </div>
          </div>
          <div style="font-size:.75rem;opacity:.7;margin-bottom:10px;">Tap a seed to play it.</div>
          ${grid}
          <div style="display:flex;gap:12px;margin-top:12px;font-size:.72rem;opacity:.8;flex-wrap:wrap;">
            <span>${dot(solvedColor)} solved</span>
            <span>${dot(progressColor)} in progress</span>
            <span>${dot(failedColor)} failed</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:transparent;border:1px solid #3a3f47;border-radius:2px;"></span> not started</span>
            <span><span style="color:#f4c542;">★</span> hard</span>
            <span><span style="color:#c9ccd1;">★</span> normal</span>
          </div>
        </div>`;
    }

    _wireArchive() {
        const $ = window.$;
        this._el.querySelectorAll('.walkdle-arch-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._archiveFilter = btn.getAttribute('data-filter') || 'all';
                // Swap the panel content in place (no slide) so filtering is
                // instant and doesn't re-slide the whole panel.
                const slot = this._el.querySelector('#walkdle-archive-slot');
                if (slot) { slot.innerHTML = this._archiveHtml(); this._wireArchive(); }
            });
        });
        // Delegated click for the (potentially large) seed grid.
        const panel = this._el.querySelector('#walkdle-archive-panel');
        if (panel) panel.addEventListener('click', (e) => {
            const chip = e.target.closest && e.target.closest('.walkdle-seed-chip');
            if (!chip) return;
            const w = chip.getAttribute('data-seed');
            if (!w) return;
            // Fade the button back, slide the panel up, then load and play it.
            const slot = this._el.querySelector('#walkdle-archive-slot');
            const arch = this._el.querySelector('#walkdle-archive');
            this._archiveOpen = false;
            this._setArchiveBtnActive(arch, false);
            const finish = () => { if (slot) slot.innerHTML = ''; this._loadRandom(w); };
            const $p = $ ? $('#walkdle-archive-panel') : null;
            if ($p && $p.length) $p.stop(true, true).slideUp(180, finish);
            else finish();
        });
    }

    _shiftMonth(n) {
        const [y, m] = this._calendarMonth.split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 1 + n, 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // --- Wiring -------------------------------------------------------------

    _toast(msg) {
        try {
            const t = document.createElement('div');
            t.textContent = msg;
            t.setAttribute('role', 'status');
            t.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);'
                + 'z-index:3000;max-width:88%;padding:10px 16px;border-radius:8px;'
                + 'background:var(--bg-secondary,#23272e);color:var(--text-primary,#fff);'
                + 'border:1px solid var(--border-color,#3a3f47);box-shadow:0 4px 16px rgba(0,0,0,.4);'
                + 'font-size:.9rem;text-align:center;pointer-events:none;opacity:0;transition:opacity .18s;';
            document.body.appendChild(t);
            requestAnimationFrame(() => { t.style.opacity = '1'; });
            setTimeout(() => {
                t.style.opacity = '0';
                setTimeout(() => t.remove(), 250);
            }, 2600);
        } catch (_e) { /* non-fatal */ }
    }

    _wireClose() {
        const btn = this._el.querySelector('#walkdle-close');
        if (btn) btn.addEventListener('click', () => { window.location.hash = ''; });
    }

    _wireDateNav() {
        const prev = this._el.querySelector('#walkdle-prev');
        const next = this._el.querySelector('#walkdle-next');
        const today = this._el.querySelector('#walkdle-today');
        const cal = this._el.querySelector('#walkdle-cal');
        if (prev) prev.addEventListener('click', () => { if (!prev.disabled) this._loadDate(addDays(this._date, -1)); });
        if (next) next.addEventListener('click', () => { if (!next.disabled) this._loadDate(addDays(this._date, 1)); });
        if (today) today.addEventListener('click', () => { if (!today.disabled) this._loadDate(utcDateString()); });
        if (cal) cal.addEventListener('click', () => this._toggleCalendar());
        const arch = this._el.querySelector('#walkdle-archive');
        if (arch) arch.addEventListener('click', () => this._toggleArchive());
        // Random / seed mode controls.
        const rnd = this._el.querySelector('#walkdle-random');
        if (rnd) rnd.addEventListener('click', () => this._startRandom());
        const resetSeed = this._el.querySelector('#walkdle-reset-seed');
        if (resetSeed) resetSeed.addEventListener('click', () => this._resetToCurrentSeed());
        const daily = this._el.querySelector('#walkdle-daily');
        if (daily) daily.addEventListener('click', () => this._loadDate(utcDateString()));
        const newRnd = this._el.querySelector('#walkdle-random-new');
        if (newRnd) newRnd.addEventListener('click', () => this._loadRandom(randomSeed(this._items)));
        const seedGo = this._el.querySelector('#walkdle-seed-go');
        const seedInput = this._el.querySelector('#walkdle-seed-input');
        const loadSeed = () => {
            const s = sanitizeSeed(seedInput ? seedInput.value : '');
            this._loadRandom(s || this._seed || randomSeed(this._items));
        };
        if (seedGo) seedGo.addEventListener('click', loadSeed);
        if (seedInput) seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadSeed(); } });
    }

    _startRandom() {
        // Resume an in-progress random from this session, else roll a new seed.
        let active = null;
        try { active = sanitizeSeed(localStorage.getItem('walkdle_random_seed')) || null; } catch (_e) { /* ignore */ }
        this._loadRandom(active || randomSeed(this._items));
    }

    _toggleHelp() {
        this._helpOpen = !this._helpOpen;
        this._render();
    }

    _wireHelp() {
        const btn = this._el.querySelector('#walkdle-help');
        if (btn) btn.addEventListener('click', () => this._toggleHelp());
        const close = this._el.querySelector('#walkdle-help-close');
        if (close) close.addEventListener('click', () => { this._helpOpen = false; this._render(); });
    }

    _advancedInfoHtml() {
        // NOTE: rendered into a double-quoted data-info-html attribute, so this
        // string MUST NOT contain any double-quote characters (use entities /
        // attribute-less tags only).
        return [
            '<div>',
            '<b>Advanced filters.</b> Separate terms with spaces; all terms must match.',
            '<div style=\'margin-top:6px\'><code>!word</code> or <code>-word</code> excludes items matching that word. Example: <code>!tool</code></div>',
            '<div style=\'margin-top:4px\'><code>field:N</code> or <code>field=N</code> matches a number exactly; <code>field&gt;N</code>, <code>field&lt;N</code>, <code>field&gt;=N</code>, <code>field&lt;=N</code> compare. Example: <code>value&gt;25</code></div>',
            '<div style=\'margin-top:4px\'>Number fields: <code>value</code>, <code>level</code>, <code>stats</code>, <code>tier</code> (also <code>rarity</code> or <code>quality</code>).</div>',
            '<div style=\'margin-top:4px\'>Combine them: <code>!tool value&gt;100</code> finds non-tools worth over 100.</div>',
            '<div style=\'margin-top:8px\'>Single words, quoted phrases, names, and keyword / rarity / quality / source / slot / skill terms all work without this turned on. Enabling advanced filters flags this solve as <b>Easy mode</b> when you share.</div>',
            '</div>',
        ].join('');
    }

    _helpHtml() {
        const c = this._highContrast ? STATE_COLORS_HC : STATE_COLORS;
        const exactName = this._highContrast ? 'orange' : 'green';
        const partialName = this._highContrast ? 'light blue' : 'yellow';
        const sw = (color) => `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${color};vertical-align:middle;margin-right:6px;border:1px solid rgba(255,255,255,.15);"></span>`;
        return `
        <div id="walkdle-help-panel" style="margin-bottom:14px;padding:14px 16px;border:1px solid var(--border-color,#3a3f47);border-radius:10px;background:var(--bg-secondary,#23272e);max-width:560px;line-height:1.5;font-size:.9rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <strong style="font-size:1.05rem;">How to play</strong>
            <button id="walkdle-help-close" aria-label="Close help" style="background:none;border:none;color:inherit;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button>
          </div>
          <p style="margin:0 0 10px;">Guess the hidden item in <b>${MAX_GUESSES}</b> tries. Type in the search box to find an item by its <b>name</b>, or by any attribute like a <b>keyword</b>, <b>rarity/quality</b>, <b>source</b>, <b>slot</b>, or <b>skill</b>, then pick one to submit it.</p>
          <p style="margin:0 0 10px;opacity:.85;">Want operators (<code>!word</code>, <code>field&gt;N</code>, exact compares)? Tick <b>Enable advanced filters</b> below the grid and read its <b>ⓘ</b>. Heads up: advanced filters flag the solve as <b>Easy mode</b> when you share.</p>
          <p style="margin:0 0 6px;"><b>Each guess shows how it compares to the answer, column by column.</b> For text columns (Source, Skills, Keywords):</p>
          <div style="margin:0 0 10px;padding-left:4px;">
            <div style="margin-bottom:4px;">${sw(c.green)}<b>${exactName}</b>: exact match (everything matches).</div>
            <div style="margin-bottom:4px;">${sw(c.yellow)}<b>${partialName}</b>: partial match (shares at least one value).</div>
            <div>${sw(c.absent)}<b>gray</b>: no match.</div>
          </div>
          <p style="margin:0 0 6px;"><b>Number columns</b> (Rarity/Quality, Stats, Level, Value) use arrows:</p>
          <div style="margin:0 0 10px;padding-left:4px;">
            <div style="margin-bottom:4px;">⬆️ means the answer's value is <b>higher</b> than your guess.</div>
            <div style="margin-bottom:4px;">⬇️ means the answer's value is <b>lower</b> than your guess.</div>
            <div>${sw(c.green)}${exactName} with no arrow means the exact same value.</div>
          </div>
          <p style="margin:0 0 10px;"><b>The Level column</b> can show a flat skill level (e.g. <b>45</b>) or a category percentage (e.g. <b>45% artisan</b> = needs 45% of your combined artisan-category levels). Both are compared as a single number, so the arrow still applies: ⬆️ means the answer requires a <b>higher</b> level/percent, ⬇️ a <b>lower</b> one, and ${exactName} means it requires the same.</p>
          <p style="margin:0;"><b>Walkdle Scoredle</b> (the second share button after you finish) is like Scoredle: it shows how many catalog items were still possible after each of your guesses. It's the same emoji grid as the normal share, with the <b>remaining-candidate count</b> printed to the right of each row, so you can see how quickly you narrowed it down to one.</p>
        </div>`;
    }

    _wireGuessInput() {
        const input = this._el.querySelector('#walkdle-input');
        const sugg = this._el.querySelector('#walkdle-suggest');
        const btn = this._el.querySelector('#walkdle-guess-btn');
        if (!input || !sugg) return;
        // Don't steal focus (which pops the mobile keyboard) while a panel is
        // open, or on the render right after closing the seeds panel via its
        // toggle. Tapping the archive filter tabs re-renders the whole page.
        const suppress = this._suppressGuessFocus;
        this._suppressGuessFocus = false;
        if (!this._archiveOpen && !this._calendarOpen && !suppress) input.focus();
        const guessed = new Set(this._guesses.map((g) => g.id));
        let currentMatches = [];
        const $ = window.jQuery || window.$;
        const showSuggest = () => { if ($) { $(sugg).stop(true, true).slideDown(140); } else { sugg.style.display = 'block'; } };
        const hideSuggest = () => { if ($) { $(sugg).stop(true, true).slideUp(140); } else { sugg.style.display = 'none'; } };

        // Lazy infinite-scroll: render matches in batches of CHUNK, append more
        // as the dropdown is scrolled near the bottom. Rendering the full match
        // list (1000+ rich rows) on every keystroke was the source of lag.
        let renderedCount = 0;
        const CHUNK = 40;
        const optionHtml = (it) => {
            const rar = _effectiveRarity(it);
            const statsLine = this._showStats
                ? `<div style="font-size:.66rem;opacity:.85;margin-top:3px;line-height:1.25;">${_esc(WALKDLE_COLUMNS.map((c) => c.display(it)).join(' | '))}</div>`
                : '';
            return `
                <div class="walkdle-opt" data-id="${_esc(it.id)}" style="display:flex;flex-direction:column;align-items:stretch;padding:7px 10px;cursor:pointer;background:var(--rarity-${rar});transition:filter .12s ease;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${it.icon ? `<img src="${_esc(it.icon)}" alt="" width="16" height="16" style="${_rarityIconFilter(rar)}" onerror="this.style.display='none'">` : ''}
                    <span>${_esc(displayName(it))}</span>
                    <span style="margin-left:auto;opacity:.65;font-size:.75rem;color:var(--rarity-${rar}-border);">${_esc(it.quality || it.rarity)}</span>
                  </div>
                  ${statsLine}
                </div>`;
        };
        const appendChunk = () => {
            const next = currentMatches.slice(renderedCount, renderedCount + CHUNK);
            if (!next.length) return;
            sugg.insertAdjacentHTML('beforeend', next.map(optionHtml).join(''));
            renderedCount += next.length;
        };
        // Delegated handlers (wired once; survive chunk appends).
        sugg.addEventListener('mouseover', (e) => { const o = e.target.closest('.walkdle-opt'); if (o) o.style.filter = 'brightness(1.3)'; });
        sugg.addEventListener('mouseout', (e) => { const o = e.target.closest('.walkdle-opt'); if (o) o.style.filter = 'none'; });
        sugg.addEventListener('click', (e) => {
            const o = e.target.closest('.walkdle-opt');
            if (!o || !sugg.contains(o)) return;
            // Select only — fill the input and remember the pick. Submitting
            // happens only via the Guess button.
            const it = this._byId[o.getAttribute('data-id')];
            if (it) { input.value = displayName(it); this._selectedGuessId = it.id; }
            hideSuggest();
            input.focus();
        });
        sugg.addEventListener('scroll', () => {
            if (renderedCount < currentMatches.length
                && sugg.scrollTop + sugg.clientHeight >= sugg.scrollHeight - 80) {
                appendChunk();
            }
        });

        const renderSuggest = () => {
            const raw = input.value.trim();
            if (raw.length < 1) { hideSuggest(); currentMatches = []; return; }
            // Tokens are ANDed across name / slot / quality / rarity / source /
            // skills / keywords / level. `!word` or `-word` negates a token, and
            // `field:N` / `=` / `>` / `<` / `>=` / `<=` filters numeric fields
            // (value, level, stats, tier). So "perfect chest craft" -> Perfect,
            // chest-slot, crafted; "!tool value>100" -> non-tools worth > 100.
            const parsed = parseWalkdleQuery(raw, { advanced: this._advancedEnabled });
            const firstText = parsed.firstText;
            const scored = [];
            for (const it of this._items) {
                if (guessed.has(it.id)) continue;
                const name = it.name.toLowerCase();
                const hay = [
                    name,
                    it.slot || '',
                    _tierTerms(it),
                    (it.sources || []).join(' '),
                    (it.skills || []).join(' '),
                    (it.keywords || []).join(' '),
                    it.level_display || '',
                ].join(' ').toLowerCase();
                if (!parsed.test(it, hay)) continue;
                // Rank by name relevance to the first plain word (if any).
                let score;
                if (!firstText) score = 0;
                else if (name.startsWith(firstText)) score = 0;
                else if (name.includes(firstText)) score = 1;
                else score = 2;
                scored.push([score, it]);
            }
            scored.sort((a, b) =>
                a[0] - b[0]
                || a[1].name.localeCompare(b[1].name)
                || String(a[1].id).localeCompare(String(b[1].id)));
            currentMatches = scored.map((x) => x[1]);
            if (currentMatches.length === 0) { hideSuggest(); return; }
            // Render only the first chunk now; appendChunk() adds more on scroll.
            sugg.scrollTop = 0;
            sugg.innerHTML = '';
            renderedCount = 0;
            appendChunk();
            showSuggest();
        };

        const resolveGuessId = () => {
            const val = input.value.trim().toLowerCase();
            // 1) Explicit row selection that still matches the field.
            if (this._selectedGuessId && this._byId[this._selectedGuessId] && !guessed.has(this._selectedGuessId)) {
                const sel = this._byId[this._selectedGuessId];
                if (displayName(sel).toLowerCase() === val || sel.name.toLowerCase() === val) return this._selectedGuessId;
            }
            if (!val) return null;
            // 2) Exact name / "Name (Quality)" match.
            const exact = this._items.find((it) => !guessed.has(it.id) &&
                (it.name.toLowerCase() === val || displayName(it).toLowerCase() === val));
            if (exact) return exact.id;
            // 3) Otherwise the best (top) substring match.
            return currentMatches.length ? currentMatches[0].id : null;
        };

        const submit = () => {
            const id = resolveGuessId();
            if (!id) return;
            // Remember the raw search text that produced this guess (the typed
            // query survives a suggestion-row click, which doesn't fire 'input').
            this._lastGuessQuery = this._lastQuery || input.value;
            input.value = '';
            this._selectedGuessId = null;
            hideSuggest();
            this._submitGuess(id);
        };

        input.addEventListener('input', () => { this._lastQuery = input.value; this._selectedGuessId = null; renderSuggest(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Enter only selects the top suggestion into the field; it does
                // NOT submit. Guesses are committed solely via the Guess button.
                e.preventDefault();
                if (currentMatches.length) {
                    const it = currentMatches[0];
                    input.value = displayName(it);
                    this._selectedGuessId = it.id;
                    hideSuggest();
                }
            }
        });
        if (btn) btn.addEventListener('click', submit);

        // "Fill last guess": populate the field with the most recent guess so
        // advanced players can edit a few letters. Does NOT submit.
        const fillBtn = this._el.querySelector('#walkdle-fill-last');
        if (fillBtn) fillBtn.addEventListener('click', () => {
            const last = this._guesses[this._guesses.length - 1];
            const fallback = (last && this._byId[last.id]) ? displayName(this._byId[last.id]) : '';
            const q = this._lastGuessQuery || fallback;  // raw search text; name only if unknown
            if (!q) return;
            input.value = q;
            this._lastQuery = q;
            this._selectedGuessId = null;  // they'll edit; resolve on submit
            input.focus();
            try { input.setSelectionRange(q.length, q.length); } catch (_e) { /* ignore */ }
            renderSuggest();
        });

        // "Random item": drop a random not-yet-guessed item into the box as a
        // starting point. Selects it (so the Guess button would submit it) but
        // does NOT submit on its own.
        const randomBtn = this._el.querySelector('#walkdle-random-item');
        if (randomBtn) randomBtn.addEventListener('click', () => {
            const pool = this._items.filter((it) => !guessed.has(it.id));
            if (pool.length === 0) return;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            const q = displayName(pick);
            input.value = q;
            this._lastQuery = q;
            this._selectedGuessId = pick.id;
            input.focus();
            try { input.setSelectionRange(q.length, q.length); } catch (_e) { /* ignore */ }
            renderSuggest();
        });

        // "Make smart filter": fold every clue from prior guesses into an
        // advanced query and drop it into the box (then narrow the suggestions).
        const smartBtn = this._el.querySelector('#walkdle-smart-filter');
        if (smartBtn) smartBtn.addEventListener('click', () => {
            const q = buildSmartFilter(this._guesses, this._byId);
            input.value = q;
            this._lastQuery = q;
            this._selectedGuessId = null;
            input.focus();
            try { input.setSelectionRange(q.length, q.length); } catch (_e) { /* ignore */ }
            renderSuggest();
        });

        const statsToggle = this._el.querySelector('#walkdle-showstats');
        if (statsToggle) {
            statsToggle.addEventListener('change', () => {
                if (statsToggle.checked) {
                    // Turning stats on flags this game Normal mode (sticky). Warn
                    // the first time it would downgrade a clean game — but not if
                    // it's already Easy (advanced filters outrank) or already
                    // flagged Normal.
                    if (!this._easyMode && !this._statsUsed) {
                        const ok = window.confirm('Showing stats will flag this game as Normal mode. Do you want to continue?');
                        if (!ok) { statsToggle.checked = false; return; }
                        this._statsUsed = true;
                    }
                    this._showStats = true;
                } else {
                    this._showStats = false;
                }
                this._persist();
                renderSuggest();
            });
        }
        const advToggle = this._el.querySelector('#walkdle-advanced');
        if (advToggle) {
            advToggle.addEventListener('change', () => {
                if (advToggle.checked) {
                    // First opt-in for this game: warn, then flag Easy (sticky).
                    if (!this._easyMode) {
                        const ok = window.confirm('This game will now be flagged as Easy mode. Do you want to continue?');
                        if (!ok) { advToggle.checked = false; return; }
                        this._easyMode = true;
                    }
                    this._advancedEnabled = true;
                } else {
                    // Unchecking turns operators off, but the Easy flag stays.
                    this._advancedEnabled = false;
                }
                this._persist();
                this._render();  // show/hide smart-filter button + re-wire input under the new mode
            });
        }
        const hcToggle = this._el.querySelector('#walkdle-hc');
        if (hcToggle) {
            hcToggle.addEventListener('change', () => {
                this._highContrast = hcToggle.checked;
                try { localStorage.setItem('walkdle_high_contrast', this._highContrast ? '1' : '0'); } catch (_e) { /* ignore */ }
                this._render();  // recolor cells (and suggestions) for the new palette
            });
        }
    }

    // Resolved difficulty for this game: easy (advanced filters) > normal
    // (Show-stats assist) > hard (neither). Drives share label + scoreboard.
    _resolvedMode() {
        if (this._easyMode) return 'easy';
        if (this._statsUsed) return 'normal';
        return 'hard';
    }

    _modeLabel() {
        return { hard: 'Hard mode', normal: 'Normal mode', easy: 'Easy mode' }[this._resolvedMode()];
    }

    async _share() {
        let text;
        if (this._includeScoredle) {
            const guessItems = this._guesses.map((g) => this._byId[g.id]);
            text = buildScoredleString(this._date, this._guesses, guessItems, this._items, this._solved, MAX_GUESSES, this._highContrast, this._seed, this._modeLabel());
        } else {
            text = buildShareString(this._date, this._guesses, this._solved, MAX_GUESSES, this._highContrast, this._seed, this._modeLabel());
        }
        this._shareText(text, '#walkdle-share');
    }

    async _shareText(text, btnSelector) {
        try {
            if (navigator.share && navigator.canShare && navigator.canShare({ text })) {
                await navigator.share({ text });
                return;
            }
        } catch (_e) { /* fall through */ }
        try {
            await navigator.clipboard.writeText(text);
            const btn = this._el.querySelector(btnSelector);
            if (btn) { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = old; }, 1500); }
        } catch (_e) {
            window.prompt('Copy your result:', text);
        }
    }
}
