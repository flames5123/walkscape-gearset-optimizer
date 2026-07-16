/**
 * StatsReportPage
 *
 * Full-page panel for bulk optimization stats reports.
 * Follows the TravelConfigPage pattern (standalone ES6 module, not extending Component).
 *
 * Nav icon states: idle | running | unread
 * URL hash: #stats-report
 */

import api from './api.js';
import store from './state.js';

import { formatFixed } from './utils/number-format.js';
import { decodeGearsetSlots, renderMiniGearPreview, activityIdFromName } from './utils/gearset-decode.js';
import { getPetIconPath } from './utils/pet-utils.js';
import { wireInfoIcons } from './info-popover.js';
import { maybeShowLocalSpeedWarning } from './local-speed-warning.js';
import { wireDropAnchor } from './drop-item-popover.js';
import { resolveItemIcon } from './utils/resolve-item-icon.js';
import { resetLocalGoalsReport } from './local-compute.js';
import { buildGoalsReportConfig, applyGoalsReportConfig } from './utils/goals-report-selection.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORIES = [
    { key: 'xp', label: 'Best XP/Step Activity per Skill', hasSkillFilter: true },
    { key: 'new_items', label: 'Fastest New Item Activities', hasSkillFilter: false, hasKindFilter: true },
    { key: 'chests', label: 'Best Chest Farming for Activities', hasSkillFilter: false },
    { key: 'chests_recipes', label: 'Best Chest Farming for Recipes', hasSkillFilter: false },
    { key: 'coins', label: 'Best Coin Farming Activities', hasSkillFilter: true },
];

const CATEGORY_METRIC_LABELS = {
    xp: 'XP/step',
    new_items: 'steps/item',
    chests: 'Steps/chest',
    chests_recipes: 'Steps/chest',
    coins: 'Coins/1k steps',
};

// Single-completion activities (can only ever be done once) and the custom
// stat id that flags their completion. When a result row's activity is in
// this map, an "Already done" button renders on the row (mirrors the
// new-item hide button) that sets the custom stat and drops the activity
// from the report. Mirrors SINGLE_COMPLETION_ACTIVITIES in
// util/scrapers/scrape_activities.py. Currently just "Repair the bank".
const SINGLE_COMPLETION_ACTIVITY_STAT = {
    'Repair the bank': 'repair_the_bank',
};

// Skill icon/color map keyed by lowercase skill id
const SKILL_META = {
    agility: { icon: '/assets/icons/text/skill_icons/agility.svg', color: 'var(--skill-agility-color, #F05FBE)' },
    carpentry: { icon: '/assets/icons/text/skill_icons/carpentry.svg', color: 'var(--skill-carpentry-color, #F18C62)' },
    cooking: { icon: '/assets/icons/text/skill_icons/cooking.svg', color: 'var(--skill-cooking-color, #F0AD5F)' },
    crafting: { icon: '/assets/icons/text/skill_icons/crafting.svg', color: 'var(--skill-crafting-color, #E9487C)' },
    fishing: { icon: '/assets/icons/text/skill_icons/fishing.svg', color: 'var(--skill-fishing-color, #60DAEF)' },
    foraging: { icon: '/assets/icons/text/skill_icons/foraging.svg', color: 'var(--skill-foraging-color, #ABD3A1)' },
    hunting: { icon: '/assets/icons/text/skill_icons/hunting.svg', color: 'var(--skill-hunting-color, #FEA255)' },
    mining: { icon: '/assets/icons/text/skill_icons/mining.svg', color: 'var(--skill-mining-color, #8CA4D4)' },
    smithing: { icon: '/assets/icons/text/skill_icons/smithing.svg', color: 'var(--skill-smithing-color, #E2A6A6)' },
    tailoring: { icon: '/assets/icons/text/skill_icons/tailoring.svg', color: 'var(--skill-tailoring-color, #AAF2FE)' },
    trinketry: { icon: '/assets/icons/text/skill_icons/trinketry.svg', color: 'var(--skill-trinketry-color, #FEE0AC)' },
    woodcutting: { icon: '/assets/icons/text/skill_icons/woodcutting.svg', color: 'var(--skill-woodcutting-color, #5EF06B)' },
};

// Populated dynamically from /api/skills — correct categories from the server
let SKILL_GROUPS = [
    { label: 'Gathering', skills: [] },
    { label: 'Artisan', skills: [] },
    { label: 'Utility', skills: [] },
];

// Lookup: skill display name (e.g. "Mining") → category ("Gathering" / "Artisan" / "Utility").
// Populated by loadSkillGroups() from /api/skills. Defaulted with the
// canonical mapping so first paint works before the API resolves.
let SKILL_TO_CATEGORY = {
    Agility: 'Utility',
    Fishing: 'Gathering', Foraging: 'Gathering', Hunting: 'Gathering',
    Mining: 'Gathering', Woodcutting: 'Gathering',
    Carpentry: 'Artisan', Cooking: 'Artisan', Crafting: 'Artisan',
    Smithing: 'Artisan', Tailoring: 'Artisan', Trinketry: 'Artisan',
};

const CATEGORY_ICONS = {
    Gathering: '/assets/icons/text/skill_types/gathering.svg',
    Artisan:   '/assets/icons/text/skill_types/artisan.svg',
    Utility:   '/assets/icons/text/skill_types/utility.svg',
};

// All chest names the chest-farming chips can render. Used as the
// "default = all selected" set when localStorage doesn't have a saved
// selection yet. _renderChestList builds the chip list from the same
// underlying mapping — keep these in sync if a chest is added.
const ALL_CHEST_NAMES = [
    'Agility chest', 'Fishing chest', 'Foraging chest', 'Hunting chest',
    'Mining chest', 'Woodcutting chest',
    'Carpentry chest', 'Cooking chest', 'Crafting chest',
    'Smithing chest', 'Tailoring chest', 'Trinketry chest',
    'Coral chest', 'Rusty chest', 'Sunken chest',
];

// Category colors — same hex values as the column-1 skill-group palette
// (--skillgroup-gathering-color etc.) so the stats report's category
// borders match the visual identity of the rest of the app.
const CATEGORY_COLORS = {
    Gathering: '#67E7AA',
    Artisan:   '#F9C176',
    Utility:   '#BB83DC',
};

const CATEGORY_ORDER = ['Gathering', 'Artisan', 'Utility'];

const COLLAPSE_STATE_KEY = 'stats_report_collapse_state_v1';
// Persist the user's skill selection (the chips under XP / Coin Farming)
// across reloads. Keyed by category so XP and Coin Farming can be tuned
// independently if the user wants. Empty array = explicit "no skills"
// (no jobs queued for that category) — distinct from "default" which is
// "all skills selected" and is used when no localStorage key exists yet.
const SELECTED_SKILLS_KEY = 'stats_report_selected_skills_v1';
// Persist the user's chest selection (chips under Best Chest Farming +
// Best Chest Farming for Recipes). Same semantic as skills: missing key
// means "default = all selected", explicit empty array means "user
// deselected everything". Persisted as an array of chest display names
// e.g. ["Mining chest","Coral chest"].
const SELECTED_CHESTS_KEY = 'stats_report_selected_chests_v1';
// Categories whose WTO sub-filter is skill chips / chest chips. Selections are
// kept per-category (see _selectedSkillsByCat / _selectedChestsByCat) so e.g.
// "Trinketry chest" can be off for activities but on for recipes.
const SKILL_CHIP_CATEGORIES = ['xp', 'coins'];
const CHEST_CHIP_CATEGORIES = ['chests', 'chests_recipes'];
// Persist the run-config toggles (push notify, include pets, include
// consumables). Single localStorage key holding a small JSON object so
// we can add more flags later without burning a key per flag.
const RUN_CONFIG_KEY = 'stats_report_run_config_v1';

// 2026-05-22 (T17 follow-up): WTO sub-filter for "Fastest New Item Activities".
// The category emits one (activity, kind) job per kind so the user can scope
// the run to just gear / tools / eggs / collectibles. Mirrors the
// chests/skills WTO sub-filter pattern (default-all-selected, persisted to
// its own localStorage key, filter passed through to the worker).
const SELECTED_KINDS_KEY = 'stats_report_selected_kinds_v1';
const ALL_KINDS = ['gear', 'tools', 'eggs', 'collectibles'];
// 2026-05-22: kind icons sourced from keywords/* (all 20-native) so
// they render full-native at 20px per the icon-divisor rule (no 32px
// on 20-native). The CSS override `.stats-report-kind-chip img` sizes
// them to 20px (the global skill-chip rule is 32px which we don't want
// to apply here — would violate the divisor rule for 20-native icons).
const KIND_META = {
    gear:         { label: 'Gear',         color: '#5B8BD9', icon: '/assets/icons/keywords/proper_gear.svg' },
    tools:        { label: 'Tools',        color: '#D9A55B', icon: '/assets/icons/keywords/tool.svg' },
    eggs:         { label: 'Eggs',         color: '#A55BD9', icon: '/assets/icons/keywords/pet_egg.svg' },
    collectibles: { label: 'Collectibles', color: '#5BD988', icon: '/assets/icons/keywords/collectible.svg' },
};

// Misc-chest color overrides — aligned with the icon-derived palette
// the user picked for the misc chest chips. Skill chests use SKILL_META
// for their primary skill's color (Fishing chest = Fishing color, etc).
// This map is only consulted for the three misc chests; everything else
// falls back to skill color via SKILL_META.
const MISC_CHEST_COLORS = {
    'Coral chest':  '#92E8C0',
    'Rusty chest':  '#b7410e',
    'Sunken chest': '#5ec47a',
};

// Resolve a chest name → display color. Skill chests (e.g. "Mining chest",
// "Foraging chest") are named with the skill prefix, so we strip ' chest'
// and look up the skill in SKILL_META. Falls back to text-secondary.
function chestColorFor(chestName) {
    if (!chestName) return 'var(--text-secondary)';
    if (MISC_CHEST_COLORS[chestName]) return MISC_CHEST_COLORS[chestName];
    const skillGuess = chestName.replace(/\s+chest$/i, '').toLowerCase();
    return SKILL_META[skillGuess]?.color || 'var(--text-secondary)';
}

// Level → XP threshold table. LEVEL_XP[i] is the total XP required to be
// at level (i+1). Mirrors components/calculator-section.js so steps-to-next
// math always agrees with the calculator.
const LEVEL_XP = [
    0, 83, 174, 276, 388, 512, 650, 801, 969,
    1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
    4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
    13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
    37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
    101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
    273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
    737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
    1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
    5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431,
];

function levelFromXp(xp) {
    for (let i = LEVEL_XP.length - 1; i >= 0; i--) {
        if (xp >= LEVEL_XP[i]) return i + 1;
    }
    return 1;
}

/**
 * Compute "steps to next level" using the user's spec from Q2:
 *   actions_needed = ceil(xp_to_next / xp_per_action)
 *   steps = max(displayed_steps_per_action,
 *               actions_needed × expected_steps_per_action)
 *
 * Returns null when we can't compute (no metrics, max level, etc).
 */
function stepsToNextLevel(skillName, metrics, characterSkills) {
    if (!skillName || !metrics) return null;
    const xpPerAction = Number(metrics.primary_xp_per_action);
    const displayedSteps = Number(metrics.displayed_steps_per_action);
    const expectedSteps = Number(metrics.expected_steps_per_action);
    if (!Number.isFinite(xpPerAction) || xpPerAction <= 0) return null;
    if (!Number.isFinite(displayedSteps) || displayedSteps <= 0) return null;
    if (!Number.isFinite(expectedSteps) || expectedSteps <= 0) return null;

    const skills = characterSkills || {};
    const lowerKey = String(skillName).toLowerCase();
    const currentXp = Number(skills[lowerKey] ?? skills[skillName] ?? 0);
    const currentLevel = levelFromXp(currentXp);
    // LEVEL_XP[currentLevel] is the XP threshold for the NEXT level (since
    // LEVEL_XP[i] is XP for level i+1, and currentLevel maps to LEVEL_XP
    // index currentLevel-1).
    const nextThreshold = LEVEL_XP[currentLevel];
    if (nextThreshold == null) return 0; // already max level
    const xpToNext = Math.max(0, nextThreshold - currentXp);
    if (xpToNext === 0) return 0;
    const actionsNeeded = Math.ceil(xpToNext / xpPerAction);
    return Math.max(Math.ceil(displayedSteps), actionsNeeded * Math.ceil(expectedSteps));
}

async function loadSkillGroups() {
    try {
        const data = await $.get('/api/skills');
        const byCategory = data.by_category || {};
        SKILL_GROUPS = ['Gathering', 'Artisan', 'Utility'].map(label => ({
            label,
            skills: (byCategory[label] || []).map(s => ({
                name: s.display_name,
                id: s.id,
                icon: SKILL_META[s.id]?.icon || `/assets/icons/text/skill_icons/${s.id}.svg`,
                color: SKILL_META[s.id]?.color || 'var(--text-secondary)',
            })),
        }));
        // Build skill→category lookup so result rendering can group by
        // Gathering/Artisan/Utility without re-walking SKILL_GROUPS.
        const newMap = {};
        for (const group of SKILL_GROUPS) {
            for (const s of group.skills) newMap[s.name] = group.label;
        }
        if (Object.keys(newMap).length > 0) SKILL_TO_CATEGORY = newMap;
    } catch (e) {
        console.warn('[StatsReportPage] Failed to load skills from API:', e);
    }
}
const STALL_TIMEOUT_MS = 60000;
const MAX_POLL_FAILURES = 3;
const POLL_INTERVAL_MS = 3000;
// Re-fetch the (potentially multi-MB) results payload + rebuild the results
// DOM at most this often during a run. The progress bar still advances every
// poll tick from the tiny /status response; only the heavier result rows are
// throttled. Without this the full results were re-fetched and every gear/item
// <img> recreated on every 3s tick (hundreds of MB + icons reloading ~every 2s).
const RESULTS_RENDER_MIN_INTERVAL_MS = 8000;

// 2026-06-30 (jwbail): if the progress bar sits on "Finishing…"
// (completed>=total from the client's local progress) for longer than this
// without the run flipping to complete server-side, the "Finishing…" watchdog
// fires a one-shot recovery (re-POST /local-complete + forced poll, then an
// escape-hatch toast). Pairs with the server-side lazy-finalize safety net in
// /api/stats-report/status. Bug report def8e0d5.
const FINISHING_WATCHDOG_MS = 90000;

// ============================================================================
// STATS REPORT PAGE CLASS
// ============================================================================

/**
 * 2026-05-28 (jwbail): Resolve a recipe display name (e.g.
 * "Cut a birch plank") to its recipe id (e.g. "birch_plank") by
 * searching window.recipeSelector.recipesData. Recipe ids in
 * /api/recipes are derived from the auto-generated module attr names
 * (e.g. BIRCH_PLANK.lower()), which are NOT a slug of the display
 * name — so we can't reuse activityIdFromName for recipes.
 *
 * recipesData shape: { skill: [{ id, name, ... }], ... }
 *
 * Returns null when the dropdown hasn't loaded yet or no exact-name
 * match is found. Caller should fall back gracefully.
 */
function _findRecipeIdByName(name) {
    if (!name) return null;
    const data = window.recipeSelector && window.recipeSelector.recipesData;
    if (!data) return null;
    const target = String(name).trim().toLowerCase();
    // recipesData may be an object grouped by skill OR a flat
    // { recipes: [...] } envelope — handle both shapes.
    const buckets = (data.recipes && Array.isArray(data.recipes))
        ? [data.recipes]
        : Object.values(data).filter(Array.isArray);
    for (const bucket of buckets) {
        for (const r of bucket) {
            if (r && r.name && String(r.name).toLowerCase() === target) {
                return r.id || null;
            }
        }
    }
    return null;
}

export class StatsReportPage {
    constructor(elementSelector) {
        this._$el = $(elementSelector);
        this._runId = null;
        this._isRunning = false;
        this._localRunActive = false;
        // 2026-06-30 (jwbail): "Finishing…" watchdog state. _finishingSince is
        // when we first entered the completed>=total ("Finishing…") state
        // contiguously; _finishingRecoveryFired is a one-shot guard so we don't
        // spam re-finalize POSTs. Both reset whenever the bar leaves Finishing
        // (new run / fresh progress / completion). See bug report def8e0d5.
        this._finishingSince = null;
        this._finishingRecoveryFired = false;
        this._isPageOpen = false;
        this._pollInterval = null;
        this._elapsedInterval = null;
        this._results = {};
        this._selectedCategories = new Set(['xp', 'new_items', 'chests', 'chests_recipes', 'coins']);
        // 2026-05-21: hydrate categories from localStorage if a prior
        // run config was saved. Default = all selected (above). User
        // toggles persist via _saveRunConfig() in the change handler.
        try {
            const _cfgEarly = JSON.parse(localStorage.getItem(RUN_CONFIG_KEY) || '{}');
            if (_cfgEarly && Array.isArray(_cfgEarly.selectedCategories)) {
                this._selectedCategories = new Set(_cfgEarly.selectedCategories);
            }
        } catch (_) { /* keep default */ }
        // Skill chip selection per the 2026-05-20 polish: defaults to ALL
        // skills selected (was: empty=means-all). User can deselect any
        // chip; an empty selection now means "no skills" (no jobs created
        // for that category). Persisted to localStorage.
        //
        // Initialized empty here because SKILL_GROUPS isn't loaded yet at
        // construction time. _hydrateSelectedSkills() runs after
        // loadSkillGroups() resolves and either loads the saved list from
        // localStorage or defaults to all skills.
        // 2026-06-16 (jwbail): selections are now PER CATEGORY. Skill chips
        // appear under both "xp" and "coins"; chest chips under both "chests"
        // (activities) and "chests_recipes". Previously a single shared Set
        // backed all of them, so a chest/skill toggled in one category bled
        // into the other and they collapsed together on reload. Each category
        // now owns its own Set (lazily defaulted to "all selected"), persisted
        // as a {categoryKey: [names]} map.
        this._selectedSkillsByCat = {};   // {xp:Set, coins:Set}
        this._selectedChestsByCat = {};   // {chests:Set, chests_recipes:Set}
        this._selectedSkillsHydrated = false;
        this._selectedChestsHydrated = false;
        // 2026-05-22 (T17 follow-up): WTO kind filter for new_items.
        // Default = all 4 kinds selected (matches chest/skill defaults).
        this._selectedKinds = new Set();
        this._selectedKindsHydrated = false;
        this._pollFailures = 0;
        this._lastProgressAt = null;
        this._startedAt = null;
        this._totalJobs = 0;
        this._completedJobs = 0;
        this._lastRenderedCompleted = 0;   // gates the heavy results re-fetch/render in _pollProgress
        this._lastResultsRenderAt = 0;     // throttle marker for the heavy results render
        this._navIconState = 'idle'; // 'idle' | 'running' | 'unread'
        this._staleDismissed = false;

        // Live per-scope progress from the local (Pyodide) goals-report
        // worker. The browser computes scopes sequentially and only
        // batch-POSTs every 8 to the backend, so the /status poll alone
        // jumps 0 -> 8 -> 10. The worker also emits a per-scope progress
        // event (done = i + 1); listen for it so the bar advances
        // 1/10, 2/10, ... live without needing a backend round-trip per
        // scope. Monotonic max so the batch-lagged poll (which catches up
        // a whole batch at once) can never drag the bar backwards.
        this._onLocalProgress = (e) => {
            const d = (e && e.detail) || {};
            // A local progress event means a browser (Pyodide) run is driving
            // the bar. Mark it active so _pollProgress lets these live events
            // own the total instead of fighting the lagging server count
            // (the old 671/669 flip).
            this._localRunActive = true;
            if (typeof d.total === 'number' && d.total > 0) {
                this._totalJobs = d.total;
            }
            if (typeof d.done === 'number') {
                this._completedJobs = Math.max(this._completedJobs || 0, d.done);
                this._lastProgressAt = Date.now();
            }
            this._updateProgressBar();
        };
        window.addEventListener('statsReportLocalProgress', this._onLocalProgress);

        // Keep the "Run locally" checkbox in sync with Settings >
        // Optimization > Run locally (same setting, two surfaces). Fires
        // when the setting is toggled elsewhere (runLocalOptimizationChanged)
        // or first loaded from the server (optimizationSettingsLoaded,
        // dispatched by settings-modal loadOptimizationSettings) — both read
        // the authoritative window.settingsModal.runLocalOptimization value,
        // which also resolves the page-load render race (the checkbox renders
        // before settingsModal finishes its async config fetch).
        this._syncRunLocalCheckbox = () => {
            const enabled = !!(window.settingsModal && window.settingsModal.runLocalOptimization);
            const $cb = this._$el && this._$el.find && this._$el.find('#stats-report-run-local-checkbox');
            if ($cb && $cb.length) $cb.prop('checked', enabled);
        };
        window.addEventListener('runLocalOptimizationChanged', this._syncRunLocalCheckbox);
        window.addEventListener('optimizationSettingsLoaded', this._syncRunLocalCheckbox);

        // When a LOCAL (Pyodide) run settles, make sure the UI catches up.
        // A transient server outage mid-run (e.g. a deploy 502) can trip the
        // MAX_POLL_FAILURES guard and stop /status polling, leaving the page
        // stuck "running" (Optimize disabled) even though the worker kept
        // computing locally and its retried POSTs eventually completed the run
        // server-side. On this event, if we still think we're running, resume
        // polling so the next tick sees status=complete and re-enables the UI
        // — no manual reload needed.
        this._onLocalRunFinished = () => {
            this._localRunActive = false;
            // 2026-07-11 (bug 30add94e): the browser has now posted ALL its
            // scopes and finalized the run. A local run's server-side stale
            // precount can undercount how many scopes the browser actually
            // runs, so the /local-scope self-finalize can flip the run to
            // 'complete' EARLY (at completed>=total) — a poll that caught that
            // early flip rendered a PARTIAL report and then stopped polling,
            // leaving the finished FULL report unshown until the user manually
            // navigated back or re-pressed Optimize (the user-reported "it
            // notified me it finished but the report won't show"). Now that the
            // full result set is persisted, force an immediate status+results
            // reconcile so the COMPLETE report paints on its own. Re-arm the
            // "Finishing…" watchdog fields too, so a genuinely slow finalize is
            // not permanently abandoned by its one-shot recovery guard.
            this._finishingSince = null;
            this._finishingRecoveryFired = false;
            if (!this._pollInterval && (this._isRunning || this._isPageOpen)) {
                this._startPolling();
            }
            // _pollProgress self-guards on this._pollInterval, so on a closed,
            // already-settled page this is a no-op and the on-return
            // _loadInitialStatus path renders instead. When the page is open it
            // fetches the full persisted results and renders immediately rather
            // than waiting for the next poll tick.
            try { this._pollProgress(); } catch (_) {}
        };
        window.addEventListener('statsReportLocalRunFinished', this._onLocalRunFinished);

        // 2026-06-15 (jwbail): when the user picks "Continue in browser" or
        // "Finish on server" from the resume popup, enter the SAME running UI
        // that a fresh Optimize All (or a reload landing on a running run)
        // shows — progress section visible, nav spinner, /status polling.
        // continue-local-run-popup.js dispatches goalsReportResumeStarted
        // BEFORE kicking the local resume / server handoff. Without this the
        // work resumed but the page showed no running state, so it "looked
        // like nothing was continuing" and the user had to click Optimize All
        // manually (which DID set up the UI). Mirrors _loadInitialStatus's
        // running branch.
        this._onResumeStarted = (e) => {
            const d = (e && e.detail) || {};
            if (d.run_id) this._runId = d.run_id;
            if (typeof d.completed === 'number') {
                this._completedJobs = Math.max(this._completedJobs || 0, d.completed);
            }
            this._isRunning = true;
            this._lastProgressAt = Date.now();
            try { this._showProgressSection(); } catch (_) {}
            if (!this._pollInterval) { try { this._startPolling(); } catch (_) {} }
            try { this._updateNavIconState('running'); } catch (_) {}
        };
        window.addEventListener('goalsReportResumeStarted', this._onResumeStarted);

        // 2026-07-06 (jwbail) bug d8f4ea98: on mobile, leaving the browser and
        // coming back can freeze/evict the tab mid-load, dropping the in-flight
        // "Loading your last run…" fetch and leaving a blank report that only a
        // manual refresh recovered. When the page becomes visible again (or is
        // restored from the bfcache via pageshow), re-run the initial-status
        // load — but only when this page is open, not mid-run, and either has
        // no rendered results or the last load explicitly failed. That makes
        // the last run reappear automatically (no refresh) without re-fetching
        // on every incidental tab switch.
        this._initialLoadFailed = false;
        this._initialLoadRetryScheduled = false;
        this._recoverInitialLoadIfNeeded = () => {
            if (!this._isPageOpen) return;
            if (this._isRunning) return;
            const hasResults = this._results && Object.keys(this._results).length > 0;
            if (hasResults && !this._initialLoadFailed) return;
            this._showInitialLoading();
            this._loadInitialStatus();
        };
        this._onVisibilityRecover = () => {
            if (document.visibilityState === 'visible') this._recoverInitialLoadIfNeeded();
        };
        document.addEventListener('visibilitychange', this._onVisibilityRecover);
        this._onPageShow = () => this._recoverInitialLoadIfNeeded();
        window.addEventListener('pageshow', this._onPageShow);

        // Run-config toggles — push notification on complete, include pets,
        // include consumables. Hydrated from localStorage so the user's
        // previous choices persist across reloads. The previous version of
        // this code only kept _notifyOnComplete in memory, which is why
        // unchecking it appeared to "do nothing" after a refresh.
        const cfg = this._loadRunConfig();
        this._notifyOnComplete = cfg.notifyOnComplete !== undefined
            ? !!cfg.notifyOnComplete : true;
        this._includePets = !!cfg.includePets;
        this._includeConsumables = !!cfg.includeConsumables;
        // 2026-05-23 testing flag: skip local-search refinement, greedy only.
        this._fast = !!cfg.fast;
        // 2026-07-11 (jwbail): "Exact optimizer" toggle — always visible.
        // 2026-07-11 (jwbail): old/new engine toggle (gated to session
        // 20a57b65). Checked (default) = NEW way (today's ring de-dup + slot-
        // order). Unchecked = OLD way (ring de-dup off). Exact B&B + 5M cap +
        // greedy/1-4swap fallback are present in BOTH. Default true = new.
        this._exactNew = cfg.exactNew !== false;

        // Activity catalog cache (name → activity record from /api/activities).
        // Populated by _loadActivitiesCache() on first onNavigatedTo. Used to
        // resolve activity icon paths and primary location per result row.
        this._activitiesByName = null;
        this._activitiesByNamePromise = null;

        // Per-section/category/skill collapse state. Persists across page
        // reloads so the user's layout choices survive a refresh. Schema:
        //   { 'section:xp': true, 'category:xp:Gathering': false, 'skill:xp:Mining': true }
        // Defaults (when key absent):
        //   - section: only 'xp' is open by default; others collapsed
        //   - category: open by default
        //   - skill: open by default
        this._collapseState = this._loadCollapseState();

        // Per-(section, secondaryKey) "show more" expanded state — keyed
        // by `${section}::${secondaryKey}` (skill name or chest name).
        // Empty Set = all skills show only top-1 result.
        this._showMoreExpanded = new Set();

        // Per-row local edits from the in-place gear-slot picker
        // (2026-05-21). Map<resultId, {
        //     slots: { slot: { itemId, quality, is_fine, ... } },
        //     metricValue: number,
        //     metricsJson: { ... full breakdown },
        // }>.
        // When a row is in this map the metric pill renders with a
        // trailing asterisk + popover so the user knows the value
        // reflects their manual swap, not the optimizer's pick.
        this._alteredRows = new Map();

        // Per-row cache of slot alternatives — populated lazily by the
        // first slot click for a given row, reused for subsequent
        // clicks. Map<resultId, {
        //     alternatives: { slot: [{name, uuid, quality, improvement, ...}] },
        //     lockedAlternatives: { slot: [...] },
        //     gearsetKey: string  // identity of the gearset the cache
        //                            was computed against; on a slot
        //                            edit we invalidate so the next
        //                            click recomputes against the
        //                            new baseline.
        // }>.
        this._alternativesCache = new Map();

        // Start background polling for nav icon state (even when page is closed)
        this._startBackgroundPoll();

        // 2026-06-02 (jwbail): restore the green completion badge if a
        // prior session marked the report unread. Defer one tick so the
        // nav button HTML is in the DOM by the time we toggle visibility.
        setTimeout(() => this._hydrateUnreadFromStorage(), 0);

        // 2026-06-02 (jwbail): hydrate running-state from the server on
        // construction. Without this, a page reload (F5 / fresh tab)
        // while an optimization is running shows an idle nav icon
        // until the user actually opens the goals report — at that
        // point onNavigatedTo's _loadInitialStatus poll picks up the
        // 'running' status and flips the icon. The background poll
        // (every 10 s) ALSO doesn't help because it short-circuits
        // when both _isRunning is false AND _navIconState !== 'running'
        // (those are the only paths that trigger it). Doing a one-shot
        // status poll here gives the user a live spinner on the nav
        // header from the moment the page mounts. Deferred via
        // setTimeout(0) so it doesn't block construction; if the
        // /status call fails (e.g. no session yet), it's a silent
        // no-op — the existing flows still work.
        setTimeout(() => this._hydrateRunningStateFromServer(), 0);
    }

    _loadCollapseState() {
        try {
            const raw = localStorage.getItem(COLLAPSE_STATE_KEY);
            if (!raw) return {};
            return JSON.parse(raw) || {};
        } catch (_) {
            return {};
        }
    }

    _saveCollapseState() {
        try {
            localStorage.setItem(COLLAPSE_STATE_KEY, JSON.stringify(this._collapseState));
        } catch (_) { /* localStorage full or disabled — non-fatal */ }
        this._persistGoalsReportCollapse();
    }

    /**
     * Persist the section/category/skill expand-collapse map to the SESSION's
     * ui_config (under `goalsReportCollapse`), mirroring
     * _persistGoalsReportConfig. Keeps the layout with the session (each debug
     * session remembers its own expanded sections) and copies into snapshot
     * sessions via the full-ui_config snapshot copy. The map is a plain sparse
     * dict keyed by 'section:*' / 'category:*' / 'skill:*' etc., so it is
     * already auto-expandable — newly-added sections just fall back to the
     * _isExpanded() defaults until the user toggles them.
     */
    _persistGoalsReportCollapse() {
        try {
            if (store && store.state) {
                if (!store.state.ui) store.state.ui = {};
                store.state.ui.goalsReportCollapse = this._collapseState;
            }
            const uuid = store && store.state && store.state.session && store.state.session.uuid;
            if (uuid && api && typeof api.updateConfig === 'function') {
                // Best-effort; failure is non-fatal (localStorage still holds it).
                api.updateConfig(uuid, 'ui.goalsReportCollapse', this._collapseState);
            }
        } catch (_) { /* non-fatal — localStorage remains the fallback */ }
    }

    /**
     * Hydrate `_selectedSkills` from localStorage if present, else default
     * to ALL skills from SKILL_GROUPS. Called once after loadSkillGroups()
     * resolves (so SKILL_GROUPS is populated).
     *
     * Storage shape: array of skill display-names (e.g. ["Mining","Fishing"]).
     * Reading null/missing key triggers the "all selected" default. Reading
     * an explicit empty array preserves the user's "no skills" choice.
     */
    _allSkillNames() {
        const all = [];
        for (const group of SKILL_GROUPS) {
            for (const s of group.skills) all.push(s.name);
        }
        return all;
    }

    _hydrateSelectedSkills() {
        if (this._selectedSkillsHydrated) return;
        this._selectedSkillsHydrated = true;
        // Storage shape: { xp: [...], coins: [...] }. A category absent from
        // the saved map is lazily defaulted to "all selected" by _skillsFor.
        try {
            const raw = localStorage.getItem(SELECTED_SKILLS_KEY);
            if (raw != null) {
                const obj = JSON.parse(raw);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    for (const cat of SKILL_CHIP_CATEGORIES) {
                        if (Array.isArray(obj[cat])) {
                            this._selectedSkillsByCat[cat] = new Set(obj[cat]);
                        }
                    }
                }
            }
        } catch (_) { /* fall through — categories default to all on access */ }
    }

    /** Per-category selected-skills set, defaulting to all skills selected. */
    _skillsFor(categoryKey) {
        this._hydrateSelectedSkills();
        if (!this._selectedSkillsByCat[categoryKey]) {
            this._selectedSkillsByCat[categoryKey] = new Set(this._allSkillNames());
        }
        return this._selectedSkillsByCat[categoryKey];
    }

    _saveSelectedSkills() {
        try {
            const obj = {};
            for (const cat of SKILL_CHIP_CATEGORIES) {
                if (this._selectedSkillsByCat[cat]) {
                    obj[cat] = Array.from(this._selectedSkillsByCat[cat]);
                }
            }
            localStorage.setItem(SELECTED_SKILLS_KEY, JSON.stringify(obj));
        } catch (_) { /* localStorage full or disabled — non-fatal */ }
        this._persistGoalsReportConfig();
    }

    _hydrateSelectedChests() {
        if (this._selectedChestsHydrated) return;
        this._selectedChestsHydrated = true;
        // Storage shape: { chests: [...], chests_recipes: [...] }.
        try {
            const raw = localStorage.getItem(SELECTED_CHESTS_KEY);
            if (raw != null) {
                const obj = JSON.parse(raw);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    for (const cat of CHEST_CHIP_CATEGORIES) {
                        if (Array.isArray(obj[cat])) {
                            this._selectedChestsByCat[cat] = new Set(obj[cat]);
                        }
                    }
                }
            }
        } catch (_) { /* fall through — categories default to all on access */ }
    }

    /** Per-category selected-chests set, defaulting to all chests selected. */
    _chestsFor(categoryKey) {
        this._hydrateSelectedChests();
        if (!this._selectedChestsByCat[categoryKey]) {
            this._selectedChestsByCat[categoryKey] = new Set(ALL_CHEST_NAMES);
        }
        return this._selectedChestsByCat[categoryKey];
    }

    _saveSelectedChests() {
        try {
            const obj = {};
            for (const cat of CHEST_CHIP_CATEGORIES) {
                if (this._selectedChestsByCat[cat]) {
                    obj[cat] = Array.from(this._selectedChestsByCat[cat]);
                }
            }
            localStorage.setItem(SELECTED_CHESTS_KEY, JSON.stringify(obj));
        } catch (_) { /* localStorage full or disabled — non-fatal */ }
        this._persistGoalsReportConfig();
    }

    /**
     * Hydrate `_selectedKinds` from localStorage if present, else default
     * to ALL kinds. Same default-all + persisted-on-change semantic as
     * skills/chests. Used by the WTO sub-filter under
     * "Fastest New Item Activities" so users can scope the run to just
     * gear / tools / eggs / collectibles.
     */
    _hydrateSelectedKinds() {
        if (this._selectedKindsHydrated) return;
        this._selectedKindsHydrated = true;
        try {
            const raw = localStorage.getItem(SELECTED_KINDS_KEY);
            if (raw != null) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    this._selectedKinds = new Set(arr);
                    return;
                }
            }
        } catch (_) { /* fall through */ }
        this._selectedKinds = new Set(ALL_KINDS);
    }

    _saveSelectedKinds() {
        try {
            localStorage.setItem(
                SELECTED_KINDS_KEY,
                JSON.stringify(Array.from(this._selectedKinds))
            );
        } catch (_) { /* non-fatal */ }
        this._persistGoalsReportConfig();
    }

    // ========================================================================
    // SESSION-LEVEL SELECTION PERSISTENCE (2026-07-06, jwbail)
    // ========================================================================
    // The "What to optimize" selection (category checkboxes + skill/chest/kind
    // chips + run flags) used to live ONLY in localStorage — per-browser, not
    // per-session. Swapping between debug sessions never carried the boxes
    // along, so the user had to re-check them every time. These two methods
    // add the authoritative copy in the SESSION's ui_config (under
    // `goalsReportConfig`), which:
    //   • follows the session when you swap (each session remembers its own),
    //   • is copied into snapshot sessions automatically (the snapshot path
    //     copies the whole ui_config), and
    //   • is auto-expandable: we persist DESELECTIONS, so any newly-shipped
    //     optimization category / skill / chest / kind defaults to SELECTED
    //     for existing sessions with no migration (see goals-report-selection.js).
    // localStorage is still written (by the individual _save* methods) as the
    // cross-session default seed for brand-new sessions that have no saved
    // goalsReportConfig yet.

    _allCategoryKeys() {
        return CATEGORIES.map((c) => c.key);
    }

    /**
     * Snapshot the current in-memory selection + flags into
     * ui_config.goalsReportConfig (in-memory store first, then a best-effort
     * PATCH). Called from every _save* method so all existing change handlers
     * persist to the session with no per-handler changes.
     */
    _persistGoalsReportConfig() {
        try {
            // Materialize per-category sets so deselections reflect reality.
            const selectedSkillsByCat = {};
            for (const cat of SKILL_CHIP_CATEGORIES) selectedSkillsByCat[cat] = this._skillsFor(cat);
            const selectedChestsByCat = {};
            for (const cat of CHEST_CHIP_CATEGORIES) selectedChestsByCat[cat] = this._chestsFor(cat);
            this._hydrateSelectedKinds();

            const cfg = buildGoalsReportConfig({
                categoryKeys: this._allCategoryKeys(),
                selectedCategories: this._selectedCategories,
                skillChipCategories: SKILL_CHIP_CATEGORIES,
                allSkillNames: this._allSkillNames(),
                selectedSkillsByCat,
                chestChipCategories: CHEST_CHIP_CATEGORIES,
                allChestNames: ALL_CHEST_NAMES,
                selectedChestsByCat,
                allKinds: ALL_KINDS,
                selectedKinds: this._selectedKinds,
                flags: {
                    notifyOnComplete: this._notifyOnComplete,
                    includePets: this._includePets,
                    includeConsumables: this._includeConsumables,
                    fast: this._fast,
                    exactNew: this._exactNew,
                },
            });

            // Update the in-memory store first so a concurrent read (or a
            // later loadSession merge) sees the latest value immediately.
            if (store && store.state) {
                if (!store.state.ui) store.state.ui = {};
                store.state.ui.goalsReportConfig = cfg;
            }
            const uuid = store && store.state && store.state.session && store.state.session.uuid;
            if (uuid && api && typeof api.updateConfig === 'function') {
                // Best-effort; failure is non-fatal (localStorage still holds it).
                api.updateConfig(uuid, 'ui.goalsReportConfig', cfg);
            }
        } catch (_) { /* non-fatal — localStorage remains the fallback */ }
    }

    /**
     * Override the in-memory selection AND the expand/collapse layout with the
     * session's saved goalsReportConfig / goalsReportCollapse (if any). Runs
     * once, after loadSkillGroups() resolves and after the localStorage
     * hydrators, so the SESSION copy wins over the per-browser localStorage
     * seed. Missing categories/skills/etc. default to SELECTED and missing
     * sections keep their _isExpanded() defaults (auto-expandable). The
     * selection block is a no-op when the session has no saved config; the
     * collapse block runs independently.
     */
    _hydrateSelectionsFromSession() {
        if (this._sessionSelectionsHydrated) return;
        this._sessionSelectionsHydrated = true;
        const ui = store && store.state && store.state.ui;
        // Section/category expand-collapse layout — independent of the
        // selection config (a session may have one without the other). Merge
        // over the localStorage-seeded defaults so the SESSION's saved layout
        // wins per-key, while sections it doesn't mention keep the
        // _isExpanded() defaults (auto-expandable for new sections).
        const savedCollapse = ui && ui.goalsReportCollapse;
        if (savedCollapse && typeof savedCollapse === 'object') {
            this._collapseState = { ...this._collapseState, ...savedCollapse };
        }
        const cfg = ui && ui.goalsReportConfig;
        if (!cfg || typeof cfg !== 'object') return; // no saved selection for this session
        const applied = applyGoalsReportConfig(cfg, {
            categoryKeys: this._allCategoryKeys(),
            skillChipCategories: SKILL_CHIP_CATEGORIES,
            allSkillNames: this._allSkillNames(),
            chestChipCategories: CHEST_CHIP_CATEGORIES,
            allChestNames: ALL_CHEST_NAMES,
            allKinds: ALL_KINDS,
        });
        this._selectedCategories = applied.selectedCategories;
        // The session config is authoritative for this session: replace the
        // localStorage-seeded per-category sets outright.
        this._selectedSkillsByCat = applied.selectedSkillsByCat;
        this._selectedSkillsHydrated = true;
        this._selectedChestsByCat = applied.selectedChestsByCat;
        this._selectedChestsHydrated = true;
        if (applied.selectedKinds) {
            this._selectedKinds = applied.selectedKinds;
            this._selectedKindsHydrated = true;
        }
        const f = applied.flags || {};
        if (typeof f.notifyOnComplete === 'boolean') this._notifyOnComplete = f.notifyOnComplete;
        if (typeof f.includePets === 'boolean') this._includePets = f.includePets;
        if (typeof f.includeConsumables === 'boolean') this._includeConsumables = f.includeConsumables;
        if (typeof f.fast === 'boolean') this._fast = f.fast;
        if (typeof f.exactNew === 'boolean') this._exactNew = f.exactNew;
    }

    /**
     * Refresh the .all-selected class on every group-toggle chip
     * inside the given grid. Called after individual chip toggles
     * and after group-toggle clicks so the visual state stays in
     * sync with `_selectedSkills` / `_selectedChests`.
     */
    _refreshGroupToggleStates($grid) {
        const self = this;
        if (!$grid || !$grid.length) return;
        $grid.find('.sr-skill-group-toggle').each(function () {
            const $btn = $(this);
            const group = $btn.data('group');
            const kind = $btn.data('kind');
            const cat = $btn.data('category');
            let names = [];
            if (kind === 'skill') {
                const groupObj = SKILL_GROUPS.find(g => g.label === group);
                if (!groupObj) return;
                names = groupObj.skills.map(s => s.name);
                const allSel = names.length > 0 && names.every(n => self._skillsFor(cat).has(n));
                $btn.toggleClass('all-selected', allSel);
                $btn.attr('title', `Click to ${allSel ? 'deselect' : 'select'} all ${group} skills`);
            } else if (kind === 'chest' || kind === 'chest-misc') {
                if (kind === 'chest-misc') {
                    names = ['Coral chest', 'Rusty chest', 'Sunken chest'];
                } else {
                    const groupObj = SKILL_GROUPS.find(g => g.label === group);
                    if (!groupObj) return;
                    names = groupObj.skills.map(s => `${s.name} chest`);
                }
                const renderedNames = $grid.find('.stats-report-chest-chip').map(function () {
                    return $(this).data('chest');
                }).get();
                const groupChests = names.filter(c => renderedNames.includes(c));
                const allSel = groupChests.length > 0 && groupChests.every(c => self._chestsFor(cat).has(c));
                $btn.toggleClass('all-selected', allSel);
                $btn.attr('title', `Click to ${allSel ? 'deselect' : 'select'} all ${group} chests`);
            }
        });
    }

    /**
     * Run-config (notify on complete, include pets, include consumables)
     * persistence. One JSON object under a single localStorage key so we
     * can add more flags later. Reading null/missing/invalid blob just
     * returns {} — the caller falls back to its hard-coded defaults.
     */
    _loadRunConfig() {
        try {
            const raw = localStorage.getItem(RUN_CONFIG_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return (obj && typeof obj === 'object') ? obj : {};
        } catch (_) {
            return {};
        }
    }

    _saveRunConfig() {
        try {
            localStorage.setItem(RUN_CONFIG_KEY, JSON.stringify({
                notifyOnComplete: !!this._notifyOnComplete,
                includePets: !!this._includePets,
                includeConsumables: !!this._includeConsumables,
                fast: !!this._fast,
                exactNew: !!this._exactNew,
                // 2026-05-21: also persist the WTO category checkboxes
                // so the user's selection survives a reload. Stored as
                // an array of category keys.
                selectedCategories: Array.from(this._selectedCategories),
            }));
        } catch (_) { /* localStorage full or disabled — non-fatal */ }
        this._persistGoalsReportConfig();
    }

    /**
     * Returns whether a section/category/skill/config is currently expanded.
     * Defaults: 'xp' section open, all other sections collapsed; categories
     * and skills open by default. The 'config:what-to-optimize' card is
     * open by default but persists collapsed once the user dismisses it.
     */
    _isExpanded(key) {
        if (key in this._collapseState) return !!this._collapseState[key];
        if (key === 'section:xp') return true;
        if (key.startsWith('section:')) return false;
        if (key === 'config:what-to-optimize') return true;
        if (key.startsWith('gear:')) return false; // gear previews start collapsed
        return true; // categories and skills default-open inside an open section
    }

    _setExpanded(key, expanded) {
        this._collapseState[key] = !!expanded;
        this._saveCollapseState();
    }

    /**
     * Cache /api/activities once per page session and build a name→record
     * map keyed by activity display name (matches the worker's activity_name
     * column). Result rows look up icon_path + first location here so we can
     * render the activity tile with its real game icon and location chip
     * without doing a server roundtrip per row.
     */
    async _loadActivitiesCache() {
        if (this._activitiesByName) return this._activitiesByName;
        if (this._activitiesByNamePromise) return this._activitiesByNamePromise;
        this._activitiesByNamePromise = (async () => {
            try {
                const resp = await $.get('/api/activities');
                // /api/activities returns:
                //   { activities: [<flat list>], by_skill: {<skill>: [...]}, count: N }
                // The previous version of this loader assumed activities was
                // a {skill: [...]} dict and walked Object.values(activities)
                // — which iterated INDIVIDUAL activity objects (not arrays),
                // so Array.isArray was false and the map stayed empty. That
                // produced the user-reported "every row uses
                // /assets/icons/activities/<skill>/generic.svg" fallback.
                const map = new Map();
                const allActs = [];
                if (resp && Array.isArray(resp.activities)) {
                    allActs.push(...resp.activities);
                } else if (resp && resp.by_skill) {
                    for (const skillActs of Object.values(resp.by_skill)) {
                        if (Array.isArray(skillActs)) allActs.push(...skillActs);
                    }
                }
                for (const a of allActs) {
                    if (a && a.name) map.set(a.name, a);
                }
                this._activitiesByName = map;
                // 2026-06-02 (jwbail): build a name→icon_name map for
                // locations harvested from the activities response. Used
                // by the chests_recipes serviceless-recipe path which
                // previously slugified the location name and produced
                // 404s for any location whose icon file isn't named
                // <slug>.svg (i.e. all of them — actual filenames are
                // type-themed like castle_white_icon.svg, port_green_icon.svg).
                // User-reported 404s for /assets/icons/locations/azurazera.svg
                // and /assets/icons/locations/bilgemont_port.svg.
                const locIconMap = new Map();
                for (const a of allActs) {
                    if (!a || !Array.isArray(a.locations)) continue;
                    for (const loc of a.locations) {
                        if (loc && loc.name && loc.icon_name && !locIconMap.has(loc.name)) {
                            locIconMap.set(loc.name, loc.icon_name);
                        }
                    }
                }
                this._locationIconByName = locIconMap;
                this._activitiesByNamePromise = null;
                return map;
            } catch (e) {
                console.warn('[StatsReportPage] Failed to load activities catalog:', e);
                this._activitiesByName = new Map();
                this._locationIconByName = new Map();
                this._activitiesByNamePromise = null;
                return this._activitiesByName;
            }
        })();
        return this._activitiesByNamePromise;
    }

    // ========================================================================
    // NAVIGATION LIFECYCLE
    // ========================================================================

    onNavigatedTo() {
        this._isPageOpen = true;
        // Fire stats-report stale-detection annotation refresh.
        try { window.dispatchEvent(new CustomEvent('stats-report-opened')); } catch (_) {}
        this._staleDismissed = false;

        // 2026-05-29 (jwbail): persist content + scroll across nav. The
        // page used to fully re-render every onNavigatedTo, which (1)
        // refetched everything from the server and (2) reset scroll to
        // the top. With the dataset getting large after a full report,
        // that's a noticeable cost on every reopen. The first-open
        // path still does the full _render() + _loadInitialStatus, but
        // subsequent re-opens reuse the existing DOM and just restart
        // polling. State is invalidated only on hard refresh
        // (this._hasRendered is on the instance, lost on F5).
        if (this._hasRendered) {
            // Re-warm: nothing to fetch, nothing to render. Restart
            // polling if a run was in progress, restore scroll, and
            // refresh stale annotations (gear changes while away can
            // mark scopes stale).
            try { window.dispatchEvent(new CustomEvent('stats-report-stale-refresh')); } catch (_) {}
            // Restore scroll once the page is laid out — defer to next
            // frame so the page transition's translate/opacity has
            // resolved before we set scrollTop.
            requestAnimationFrame(() => {
                if (!this._isPageOpen) return;
                const saved = this._savedScrollTop || 0;
                if (this._$el && this._$el[0]) {
                    this._$el[0].scrollTop = saved;
                    // Some layouts scroll the inner container instead.
                    const $inner = this._$el.find('.stats-report-container, .stats-report-page');
                    if ($inner.length) $inner[0].scrollTop = saved;
                }
            });
            // Resume polling if a run is active. Reload status from API
            // either way — the user could have started/finished a run on
            // another tab while this one was hidden.
            this._loadInitialStatus();
            if (this._isRunning) {
                this._startPolling();
            }
            // Clear unread badge
            if (this._navIconState === 'unread') {
                this._updateNavIconState('idle');
            }
            return;
        }

        // First open: full render path.
        loadSkillGroups().then(() => {
            // Once SKILL_GROUPS is populated we can hydrate the selected-skill
            // set: read from localStorage if present, else default to ALL
            // skills selected. Must happen BEFORE _render() so the chip
            // .selected classes match the persisted state.
            this._hydrateSelectedSkills();
            // Chests don't depend on SKILL_GROUPS but we hydrate them in
            // the same callback to keep all "default-all" defaults in
            // one spot. Same semantic: localStorage-or-all.
            this._hydrateSelectedChests();
            this._hydrateSelectedKinds();
            // 2026-07-06 (jwbail): the SESSION's saved selection (ui_config
            // .goalsReportConfig) wins over the localStorage seed above, so
            // swapping debug sessions carries each session's own boxes. Must
            // run AFTER the localStorage hydrators and BEFORE _render() so the
            // checkbox/chip .selected classes match the persisted state.
            this._hydrateSelectionsFromSession();
            this._render();
            this._attachEvents();
            this._hasRendered = true;
            // 2026-06-19 (jwbail): first-open render is async (it awaits
            // loadSkillGroups), so it completes AFTER the
            // 'stats-report-opened' event already ran the stale annotator
            // against an empty DOM -- the WTO chips didn't exist yet, so no
            // (!) badges attached. The user then never learned that a
            // stale/degenerate chest (e.g. a tailoring chest whose recipe
            // rows are stuck at 0 steps/chest and only self-heal on a
            // re-run) needs re-optimizing. Re-fire the stale refresh now
            // that the chips are in the DOM so their badges attach.
            try { window.dispatchEvent(new CustomEvent('stats-report-stale-refresh')); } catch (_) {}
        });
        // Kick off activities catalog fetch in parallel — _renderResults
        // tolerates a missing cache and re-renders once it arrives.
        this._loadActivitiesCache().then(() => {
            if (this._isPageOpen) {
                this._renderResults();
                // Results DOM was just (re)built; re-annotate so stale
                // badges survive the render (same first-open race as above).
                try { window.dispatchEvent(new CustomEvent('stats-report-stale-refresh')); } catch (_) {}
            }
        });

        // Clear unread badge
        if (this._navIconState === 'unread') {
            this._updateNavIconState('idle');
        }

        // Resume polling if a run is active.
        // Always reload the latest run status from API on page open — the
        // _isRunning flag can be wrong after close+reopen because instance
        // state doesn't persist across navigation. _loadInitialStatus
        // checks the server and starts polling if a run is in progress,
        // which restores the progress bar correctly.
        this._loadInitialStatus();
        if (this._isRunning) {
            this._startPolling();
        }
    }

    onNavigatedFrom() {
        // 2026-05-29 (jwbail): save scroll position so re-open lands the
        // user where they were. _$el is the page root; check inner
        // containers too in case scroll moved up the tree.
        try {
            if (this._$el && this._$el[0]) {
                let scrollTop = this._$el[0].scrollTop || 0;
                if (!scrollTop) {
                    const $inner = this._$el.find('.stats-report-container, .stats-report-page');
                    if ($inner.length) scrollTop = $inner[0].scrollTop || 0;
                }
                this._savedScrollTop = scrollTop;
            }
        } catch (_) { /* non-fatal */ }
        this._isPageOpen = false;
        this._stopPolling();
        $(document).off('keydown.stats-report');
    }

    // ========================================================================
    // RENDER
    // ========================================================================

    _render() {
        const html = `
            <div class="stats-report-container">
                <!-- Header. flex-wrap so the About toggle below can occupy
                     its own full-width row INSIDE the header — that keeps it
                     ABOVE the header's bottom divider line (border-bottom),
                     per user direction (2026-06-17). -->
                <div class="stats-report-header" style="flex-wrap:wrap">
                    <h2 class="stats-report-title">
                        <img src="/assets/icons/stats-report.svg" alt="" width="22" height="22" style="vertical-align:middle">
                        Optimized Goals Report
                    </h2>
                    <button class="stats-report-close-btn" title="Close (O)">✕</button>

                    <!-- About / Help — plain inline toggle. Rendered INSIDE the
                         header on a wrapped full-width row (flex-basis:100%) so it
                         sits above the header divider line, not below it.
                         Collapsible, default open, persisted in
                         this._collapseState under key 'about:help'. -->
                    <div class="stats-report-about" style="flex-basis:100%;margin:4px 0 0 0">
                        <div class="stats-report-about-header" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;color:var(--text-secondary);font-weight:600">
                            <span class="stats-report-about-arrow" style="font-size:0.8em">${this._isExpanded('about:help') ? '▼' : '▶'}</span><span>About</span>
                        </div>
                        <div class="stats-report-about-body" style="display:${this._isExpanded('about:help') ? 'block' : 'none'};margin-top:8px;color:var(--text-secondary);font-size:0.9em;line-height:1.5">
                            <p style="margin:0 0 8px">Finds the best gear for each goal: fastest <strong>XP/step</strong>, most <strong>coins</strong>, fastest <strong>chests</strong>, and quickest path to <strong>new items</strong>, across every activity and recipe you can currently do.</p>
                            <p style="margin:0 0 8px"><strong>How to use:</strong> pick what to optimize below, click <strong>Optimize</strong>, then expand any row to see and equip its gearset.</p>
                            <p style="margin:0"><strong>The <span style="display:inline-block;background:#d33;color:#fff;border-radius:50%;width:16px;height:16px;line-height:16px;text-align:center;font-weight:bold;font-size:11px;vertical-align:middle;translate:0 -2px">!</span> badge</strong> means a row is out of date. Something on your character changed (an item, quality, pet/level, skill level, or custom stat) since it was last optimized, so its pick may no longer be best. Click <strong>Optimize</strong> to refresh the flagged rows; the badge popover lists what changed.</p>
                        </div>
                    </div>
                </div>

                <!-- Stale banner -->
                <div class="stats-report-stale-banner" id="stats-report-stale-banner" style="display:none">
                    <span style="font-size:1.3em;flex-shrink:0">⚠️</span>
                    <div style="flex:1">
                        <strong>Your inventory has changed since this report was generated.</strong>
                        <p style="margin:4px 0 10px;color:var(--text-secondary);font-size:0.9em">
                            Results may not reflect newly imported items, newly owned items, or hidden item changes.
                        </p>
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            <button class="button button-secondary stats-report-keep-btn">Keep existing results</button>
                            <button class="button button-primary stats-report-rerun-btn">Rerun optimizer</button>
                        </div>
                    </div>
                </div>

                <div class="stats-report-no-category-msg" id="stats-report-no-cat-msg"
                    style="display:${this._selectedCategories.size === 0 ? 'block' : 'none'};color:var(--text-muted);font-size:0.85em;margin:-8px 0 12px 0">
                    Select at least one category below to enable optimization.
                </div>

                <!-- Run summary: shown after a run completes live, persists until
                     a page refresh (not re-shown on reload). Filled by
                     _showRunSummary() from the poll is_complete branch. -->
                <div class="stats-report-card" id="stats-report-run-summary"
                    style="display:none;color:var(--text-secondary);font-size:0.9em"></div>

                <!-- Progress section -->
                <div class="stats-report-card" id="stats-report-progress" style="display:none">
                    <h3>Running Optimization…</h3>
                    <div class="stats-report-progress-bar-container">
                        <div class="stats-report-progress-bar-fill" id="stats-report-progress-fill" style="width:0%"></div>
                    </div>
                    <div class="stats-report-progress-meta">
                        <span id="stats-report-progress-label">0 / 0 complete</span>
                        <span id="stats-report-elapsed">0s elapsed</span>
                    </div>
                    <div id="stats-report-eta" style="color:var(--text-muted);font-size:0.82em;margin-top:2px"></div>
                </div>

                <!-- Categories — collapsible, state persisted in
                     this._collapseState under key 'config:what-to-optimize'. -->
                <div class="stats-report-card stats-report-config-card ${this._isExpanded('config:what-to-optimize') ? 'open' : ''}">
                    <div class="stats-report-config-header" data-config-section="what-to-optimize"
                         style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
                        <span class="stats-report-arrow">▼</span>
                        <h3 style="margin:0;flex:1">What to optimize</h3>
                        <span class="stats-report-cat-count" style="color:var(--text-muted);font-size:0.85em">${this._selectedCategories.size}/${CATEGORIES.length} categories</span>
                    </div>
                    <div class="stats-report-config-body">
                        <div class="stats-report-categories">
                            ${CATEGORIES.map(cat => `
                                <div class="stats-report-category-row" data-category="${cat.key}">
                                    <label class="optimizer-checkbox">
                                        <input type="checkbox" class="stats-report-cat-checkbox"
                                            data-category="${cat.key}"
                                            ${this._selectedCategories.has(cat.key) ? 'checked' : ''} />
                                        <span class="optimizer-checkbox-label" style="font-weight:500">${cat.label}</span>
                                    </label>
                                    ${cat.hasSkillFilter ? `
                                        <div class="stats-report-skill-filter ${this._selectedCategories.has(cat.key) ? '' : 'is-collapsed'}" data-for="${cat.key}">
                                            <div class="stats-report-skill-grid" data-category="${cat.key}">
                                                ${this._renderSkillChips(cat.key)}
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${(cat.key === 'chests' || cat.key === 'chests_recipes') ? `
                                        <div class="stats-report-chest-list ${this._selectedCategories.has(cat.key) ? '' : 'is-collapsed'}" data-for="${cat.key}">
                                            ${this._renderChestList(cat.key)}
                                        </div>
                                    ` : ''}
                                    ${cat.hasKindFilter ? `
                                        <div class="stats-report-kind-list ${this._selectedCategories.has(cat.key) ? '' : 'is-collapsed'}" data-for="${cat.key}">
                                            ${this._renderKindList(cat.key)}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!-- Action row: 2026-05-21 reorder — moved BELOW the
                     "What to optimize" card per user direction so the
                     flow reads top-to-bottom (configure → run). The
                     toggle rows now sit ABOVE the Optimize All button
                     (was below). All three persist to localStorage. -->
                <div class="stats-report-action-row">
                    <!-- 2026-06-02 (jwbail): conditional push notification
                         affordance — banner with Enable button when push
                         not yet granted (and not dismissed), checkbox when
                         already granted. Mirrors the bug-report Notify
                         block pattern; cleaner UX than a checkbox the user
                         can't actually use without enabling push first. -->
                    ${this._renderPushNotifySection()}
                    <div class="stats-report-toggle-row">
                        <label class="stats-report-notify-row" title="Include owned pets in optimization. Each row's chosen pet shows up in the gear preview.">
                            <input type="checkbox" id="stats-report-include-pets-checkbox" ${this._includePets ? 'checked' : ''} />
                            <span>Include pets</span>
                        </label>
                        <label class="stats-report-notify-row" title="Include owned consumables in optimization. Each row's chosen consumable shows up in the gear preview.">
                            <input type="checkbox" id="stats-report-include-consumables-checkbox" ${this._includeConsumables ? 'checked' : ''} />
                            <span>Include consumables</span>
                        </label>
                    </div>
                    ${(window._featureFlags && window._featureFlags.local_optimization) ? `
                    <div class="stats-report-toggle-row">
                        <label class="stats-report-notify-row">
                            <input type="checkbox" id="stats-report-run-local-checkbox" ${(window.settingsModal && window.settingsModal.runLocalOptimization) ? 'checked' : ''} />
                            <span>Run locally</span>
                            <span class="travel-info-icon" data-info="Runs the optimizer in your browser instead of on the server. On a reasonably modern phone or computer this is usually faster, and it reduces server load. Older or low-end devices may be slower than the server. Results are identical to a server run, and once finished they're saved to the server, so they're available on all your devices." role="button" tabindex="0" aria-label="About running locally" style="color:var(--accent, #4a90e2);font-weight:600;cursor:pointer;margin-left:4px">ⓘ</span>
                        </label>
                    </div>
                    ` : ''}
                    <div class="stats-report-toggle-row">
                        <!-- 2026-05-23: testing-only checkbox. When checked,
                             the worker skips local-search refinement and
                             just uses the greedy initial solution. Trades
                             optimal quality for ~10x faster wall-clock per
                             job. Useful when verifying the run actually
                             starts/progresses; not for normal use. -->
                        <label class="stats-report-notify-row" title="DEBUG: skip local-search refinement and just use the greedy initial solution. ~10x faster per job but suboptimal gearsets.">
                            <input type="checkbox" id="stats-report-fast-checkbox" ${this._fast ? 'checked' : ''} />
                            <span>Fast (greedy; not fully optimal)</span>
                        </label>
                        ${((window.store || (typeof store !== 'undefined' ? store : null))?.state?.session?.uuid === '00000000-0000-0000-0000-000000000000') ? ('<label class="stats-report-notify-row" title="ON = new way (today\'s ring de-dup + slot-order). OFF = old way (exact DFS, 5M-node cap, greedy+1-4swap fallback, without today\'s changes). Exact runs in both."><input type="checkbox" id="stats-report-exact-checkbox" ' + (this._exactNew ? 'checked' : '') + ' /><span>New exact optimizations (today)</span></label>') : ''}
                    </div>
                    <button class="button button-primary stats-report-optimize-btn" id="stats-report-optimize-btn"
                        ${this._selectedCategories.size === 0 ? 'disabled' : ''}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px">
                            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                        </svg>
                        Optimize All
                    </button>
                    <!-- 2026-06-02 (jwbail): Cancel button. Hidden by
                         default; _updateOptimizeButtonRunningState
                         shows it whenever a run is in progress. Click
                         flips to a 3s 'Cancel?' confirm (mirrors the
                         settings-modal delete-confirm pattern), second
                         click within 3s hits /api/stats-report/cancel
                         which SIGTERMs the worker + marks run 'failed'
                         (preserves results, unlike Reset). Mitigates
                         the server-crash scenario where a deploy
                         force-recreate mid-optimization OOM-thrashes
                         the host (oracle 2026-06-02 incident).
                         Reuses the .cancel-optimize-btn red styling
                         from column-3 (consistent with the other Cancel
                         Optimization button users see) — width:auto so
                         it sits inline next to Optimize/Reset instead
                         of taking a full row. -->
                    <button class="cancel-optimize-btn stats-report-cancel-btn" id="stats-report-cancel-btn"
                        title="Stop the in-progress optimization without wiping prior results"
                        style="margin-top:0;display:none">
                        Cancel
                    </button>
                    <!-- 2026-05-22: debug Reset button. Wipes all stats_report_* rows
                         for this session (results, stale scopes, snapshot cache, runs).
                         Useful when a worker stalls and leaves a running status that
                         blocks new runs, or when iterating on stale-detection logic. -->
                    <button class="button button-secondary stats-report-reset-btn" id="stats-report-reset-btn"
                        title="Only reset if you believe your data is corrupted. A fresh optimization can take a while to rebuild.">
                        Emergency reset
                    </button>
                </div>

                <!-- 2026-05-26 (jwbail): initial loading indicator. Visible
                     by default while _loadInitialStatus() fetches the
                     server's run status + results on page open. Hidden
                     once the fetch resolves (regardless of outcome:
                     existing results, in-progress run, or no run yet).
                     Without this the area below the Optimize button sat
                     blank for a few hundred ms with no feedback. -->
                <div id="stats-report-initial-loading" class="stats-report-initial-loading">
                    <span class="stats-report-initial-loading-spinner"></span>
                    <span class="stats-report-initial-loading-text">Loading your last run…</span>
                </div>

                <!-- Results section -->
                <div id="stats-report-results" style="display:none">
                    <div id="stats-report-results-body"></div>
                </div>
            </div>
        `;
        this._$el.html(html);
        // Wire (i) info popovers in the main page render. The WTO
        // "Run locally" info icon lives in this markup, NOT in the
        // results body that the separate wireInfoIcons($body) call in
        // _renderResults() covers — without this its hover/click did
        // nothing (jwbail 2026-06-12). wireInfoIcons is idempotent
        // (skips already-wired icons), so re-running it is safe.
        try { wireInfoIcons(this._$el[0]); } catch (e) { console.warn('[StatsReportPage] wireInfoIcons (main render) failed:', e); }
    }

    _renderSkillChips(categoryKey) {
        // Render all groups in one flat grid (3 columns, left-to-right flow)
        // with group labels as full-width row separators. The group label
        // is a clickable chip — click toggles select-all/deselect-all of
        // every skill in the group. The chip lights up with the group's
        // category color when ALL skills in the group are selected.
        const skillSet = this._skillsFor(categoryKey);
        let html = '<div class="sr-skill-flat-grid">';
        for (const group of SKILL_GROUPS) {
            if (group.skills.length === 0) continue;
            const groupColor = CATEGORY_COLORS[group.label] || 'var(--text-muted)';
            const allSelected = group.skills.every(s => skillSet.has(s.name));
            const groupIcon = CATEGORY_ICONS[group.label] || '';
            const iconHtml = groupIcon
                ? `<img src="${groupIcon}" alt="" width="25" height="25" onerror="this.style.display='none'">`
                : '';
            html += `<div class="sr-skill-group-label-row sr-skill-group-toggle ${allSelected ? 'all-selected' : ''}"
                data-group="${group.label}" data-category="${categoryKey}" data-kind="skill"
                style="--group-color:${groupColor}" title="Click to ${allSelected ? 'deselect' : 'select'} all ${group.label} skills">${iconHtml}<span>${group.label}</span></div>`;
            for (const s of group.skills) {
                const selected = skillSet.has(s.name);
                html += `
                    <div class="stats-report-skill-chip ${selected ? 'selected' : ''}"
                        data-skill="${s.name}" data-category="${categoryKey}"
                        style="--chip-color:${s.color}">
                        <img src="${s.icon}" alt="${s.name}" width="32" height="32" onerror="this.style.display='none'">
                        <span>${s.name}</span>
                    </div>`;
            }
        }
        html += '</div>';
        return html;
    }

    // Keep for backward compat
    _renderSkillOptions() {
        return '';
    }

    /**
     * Render chest list organized by skill group (like skills), with misc chests below.
     * For 'chests': all skill chests + misc (Coral, Rusty, Sunken)
     * For 'chests_recipes': only artisan skill chests
     */
    _renderChestList(categoryKey) {
        // Skill chests mapped to their skill with icon paths
        const SKILL_CHESTS = {
            Agility: { name: 'Agility chest', icon: '/assets/icons/items/containers/agility_chest.svg' },
            Fishing: { name: 'Fishing chest', icon: '/assets/icons/items/containers/fishing_chest.svg' },
            Foraging: { name: 'Foraging chest', icon: '/assets/icons/items/containers/foraging_chest.svg' },
            Hunting: { name: 'Hunting chest', icon: '/assets/icons/items/containers/hunting_chest.svg' },
            Mining: { name: 'Mining chest', icon: '/assets/icons/items/containers/mining_chest.svg' },
            Woodcutting: { name: 'Woodcutting chest', icon: '/assets/icons/items/containers/woodcutting_chest.svg' },
            Carpentry: { name: 'Carpentry chest', icon: '/assets/icons/items/containers/carpentry_chest.svg' },
            Cooking: { name: 'Cooking chest', icon: '/assets/icons/items/containers/cooking_chest.svg' },
            Crafting: { name: 'Crafting chest', icon: '/assets/icons/items/containers/crafting_chest.svg' },
            Smithing: { name: 'Smithing chest', icon: '/assets/icons/items/containers/smithing_chest.svg' },
            Tailoring: { name: 'Tailoring chest', icon: '/assets/icons/items/containers/tailoring_chest.svg' },
            Trinketry: { name: 'Trinketry chest', icon: '/assets/icons/items/containers/trinketry_chest.svg' },
        };
        // Misc chests (activity drops only, NOT faction chests). Each gets
        // an icon-derived chip color so the highlight matches the chest's
        // visual identity (per user spec):
        //   Coral chest → mint (per user direction 2026-05-21)
        //   Rusty chest → rust  (matches rusty_chest.svg)
        //   Sunken chest → green (matches sunken_chest.svg)
        const MISC_CHESTS = [
            { name: 'Coral chest',  icon: '/assets/icons/items/containers/coral_chest.svg',  color: '#92E8C0' },
            { name: 'Rusty chest',  icon: '/assets/icons/items/containers/rusty_chest.svg',  color: '#b7410e' },
            { name: 'Sunken chest', icon: '/assets/icons/items/containers/sunken_chest.svg', color: '#5ec47a' },
        ];

        const isRecipes = categoryKey === 'chests_recipes';
        // For recipes: only artisan skills have recipes
        const artisanSkills = new Set(['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring', 'Trinketry']);

        // Fallback skill groups if API hasn't loaded yet
        const groups = SKILL_GROUPS.some(g => g.skills.length > 0) ? SKILL_GROUPS : [
            { label: 'Gathering', skills: ['Fishing', 'Foraging', 'Hunting', 'Mining', 'Woodcutting'].map(n => ({ name: n, icon: SKILL_META[n.toLowerCase()]?.icon || '', color: SKILL_META[n.toLowerCase()]?.color || '' })) },
            { label: 'Artisan', skills: ['Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Tailoring', 'Trinketry'].map(n => ({ name: n, icon: SKILL_META[n.toLowerCase()]?.icon || '', color: SKILL_META[n.toLowerCase()]?.color || '' })) },
            { label: 'Utility', skills: ['Agility'].map(n => ({ name: n, icon: SKILL_META[n.toLowerCase()]?.icon || '', color: SKILL_META[n.toLowerCase()]?.color || '' })) },
        ];

        const chestSet = this._chestsFor(categoryKey);
        let html = '<div class="sr-skill-flat-grid" style="margin-top:8px">';

        for (const group of groups) {
            if (group.skills.length === 0) continue;
            // For recipes, only show Artisan group
            if (isRecipes && group.label !== 'Artisan') continue;

            const groupChests = group.skills
                .filter(s => SKILL_CHESTS[s.name])
                .filter(s => !isRecipes || artisanSkills.has(s.name));

            if (groupChests.length === 0) continue;

            const groupColor = CATEGORY_COLORS[group.label] || 'var(--text-muted)';
            const groupChestNames = groupChests.map(s => SKILL_CHESTS[s.name].name);
            const allSelected = groupChestNames.every(n => chestSet.has(n));
            const groupIcon = CATEGORY_ICONS[group.label] || '';
            const iconHtml = groupIcon
                ? `<img src="${groupIcon}" alt="" width="25" height="25" onerror="this.style.display='none'">`
                : '';
            html += `<div class="sr-skill-group-label-row sr-skill-group-toggle ${allSelected ? 'all-selected' : ''}"
                data-group="${group.label}" data-category="${categoryKey}" data-kind="chest"
                style="--group-color:${groupColor}" title="Click to ${allSelected ? 'deselect' : 'select'} all ${group.label} chests">${iconHtml}<span>${group.label}</span></div>`;
            for (const s of groupChests) {
                const chest = SKILL_CHESTS[s.name];
                const selected = chestSet.has(chest.name);
                html += `
                    <div class="stats-report-skill-chip stats-report-chest-chip ${selected ? 'selected' : ''}"
                        data-chest="${chest.name}" data-category="${categoryKey}"
                        style="--chip-color:${s.color}">
                        <img src="${chest.icon}" alt="${chest.name}" onerror="this.style.display='none'" style="width:32px;height:32px">
                        <span>${chest.name}</span>
                    </div>`;
            }
        }

        // Misc chests (only for activity chest farming, not recipes)
        if (!isRecipes && MISC_CHESTS.length > 0) {
            const miscColor = '#888';  // Neutral gray for the Misc group toggle
            const miscNames = MISC_CHESTS.map(c => c.name);
            const allMiscSelected = miscNames.every(n => chestSet.has(n));
            html += `<div class="sr-skill-group-label-row sr-skill-group-toggle ${allMiscSelected ? 'all-selected' : ''}"
                data-group="Misc" data-category="${categoryKey}" data-kind="chest-misc"
                style="--group-color:${miscColor}" title="Click to ${allMiscSelected ? 'deselect' : 'select'} all misc chests"><span>Misc</span></div>`;
            for (const chest of MISC_CHESTS) {
                const selected = chestSet.has(chest.name);
                html += `
                    <div class="stats-report-skill-chip stats-report-chest-chip ${selected ? 'selected' : ''}"
                        data-chest="${chest.name}" data-category="${categoryKey}"
                        style="--chip-color:${chest.color}">
                        <img src="${chest.icon}" alt="${chest.name}" onerror="this.style.display='none'" style="width:32px;height:32px">
                        <span>${chest.name}</span>
                    </div>`;
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * 2026-05-22 (T17 follow-up): WTO sub-filter chip list for the
     * "Fastest New Item Activities" category. Renders 4 plain-colored
     * chips (Gear / Tools / Eggs / Collectibles) — no group toggle since
     * there's only one row. Default = all selected. Toggle/persist
     * via the .stats-report-kind-chip click handler.
     *
     * Mirrors `_renderChestList` / `_renderSkillChips` styling so the
     * three sub-filters look consistent.
     */
    _renderKindList(categoryKey) {
        let html = '<div class="sr-skill-flat-grid" style="margin-top:8px">';
        for (const kind of ALL_KINDS) {
            const meta = KIND_META[kind];
            const selected = this._selectedKinds.has(kind);
            // Icon: 30x30 per user direction (2026-05-22), with 1px
            // vertical margin so the chip stays aligned. Inline style
            // overrides the global `.stats-report-skill-chip img` rule
            // (which is 32x32 for the other chip kinds).
            const iconHtml = meta.icon
                ? `<img src="${meta.icon}" alt="${meta.label}" onerror="this.style.display='none'" style="width:30px;height:30px;margin-top:1px;margin-bottom:1px">`
                : '';
            html += `
                <div class="stats-report-skill-chip stats-report-kind-chip ${selected ? 'selected' : ''}"
                    data-kind-name="${kind}" data-category="${categoryKey}"
                    style="--chip-color:${meta.color}">
                    ${iconHtml}<span style="font-weight:500">${meta.label}</span>
                </div>`;
        }
        html += '</div>';
        return html;
    }

    // ========================================================================
    // EVENTS
    // ========================================================================

    _attachEvents() {
        const $el = this._$el;

        // Strip prior handlers before re-attaching. _attachEvents() runs on
        // every onNavigatedTo(), so without this every nav fires the click
        // handler an extra time — user-reported "Equip triggers twice"
        // and a 3rd-time-back trigger fires it 3x. Namespacing scopes the
        // teardown to our handlers only.
        $el.off('.statsReport');
        $(document).off('keydown.stats-report');

        // Close button (✕). Delegated through $el so the .off('.statsReport')
        // teardown above cleans these up on every nav back to the page.
        $el.on('click.statsReport', '.stats-report-close-btn', () => {
            window.location.hash = '';
        });

        // About/Help section toggle — persists collapsed state in
        // _collapseState ('about:help') so the user only dismisses it once.
        $el.on('click.statsReport', '.stats-report-about-header', (e) => {
            const $about = $(e.currentTarget).closest('.stats-report-about');
            const $body = $about.find('.stats-report-about-body');
            const willOpen = $body.is(':hidden');
            $about.find('.stats-report-about-arrow').text(willOpen ? '▼' : '▶');
            // slideToggle for a smooth height animation (not instant
            // show/hide). stop(true,true) jumps any in-flight animation to
            // its end so rapid clicks don't queue.
            $body.stop(true, true).slideToggle(180);
            this._setExpanded('about:help', willOpen);
        });

        // Escape key closes the page (same as crafting tree)
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                window.location.hash = '';
            }
        };
        $(document).on('keydown.stats-report', this._escHandler);

        // Notify checkbox — also persisted to localStorage so unchecking
        // it survives a reload (was the silent "checkbox isn't working"
        // bug the user hit).
        $el.on('change.statsReport', '#stats-report-notify-checkbox', (e) => {
            this._notifyOnComplete = e.target.checked;
            this._saveRunConfig();
        });
        // 2026-06-02 (jwbail): push-notification banner Enable button +
        // permanent-dismiss X. Mirrors bug-report's Notify block.
        $el.on('click.statsReport', '#stats-report-enable-notifications', (e) => {
            e.preventDefault();
            this._handleEnableNotificationsClick();
        });
        $el.on('click.statsReport', '#stats-report-notify-dismiss', (e) => {
            e.preventDefault();
            this._persistPushNotifyDismissed();
            this._refreshPushNotifySection();
        });
        // Include-pets checkbox — wires through to the worker's
        // optimize_activity_gearsets.INCLUDE_PETS / PET_ITEMS flags.
        $el.on('change.statsReport', '#stats-report-include-pets-checkbox', (e) => {
            this._includePets = e.target.checked;
            this._saveRunConfig();
        });
        // Include-consumables checkbox — same as above for the consumable
        // slot. Both checkboxes only affect the next run; existing rows
        // aren't re-optimized until the user clicks "Optimize All" again.
        $el.on('change.statsReport', '#stats-report-include-consumables-checkbox', (e) => {
            this._includeConsumables = e.target.checked;
            this._saveRunConfig();
        });
        // Run-locally checkbox — mirrors Settings > Optimization > Run
        // locally. It is the SAME setting on two surfaces: update the
        // shared settingsModal state, persist via the settings save path,
        // and broadcast so the settings modal (if open) and any other
        // listener stay in sync. isLocalComputeEnabled() reads
        // window.settingsModal.runLocalOptimization, so toggling here
        // controls whether the next Optimize All runs in the browser.
        $el.on('change.statsReport', '#stats-report-run-local-checkbox', (e) => {
            const checked = e.target.checked;
            if (window.settingsModal) {
                window.settingsModal.runLocalOptimization = checked;
                try { window.settingsModal.saveGlobalOptimizationSettings(); } catch (_) { /* non-fatal */ }
            }
            try {
                window.dispatchEvent(new CustomEvent('runLocalOptimizationChanged',
                    { detail: { enabled: checked } }));
            } catch (_) { /* non-fatal */ }
        });
        // 2026-05-23 testing-only checkbox: skip local-search refinement
        // and use just the greedy initial gearset. ~10x faster but
        // suboptimal. Only meant for verifying the run starts at all.
        $el.on('change.statsReport', '#stats-report-fast-checkbox', (e) => {
            this._fast = e.target.checked;
            this._saveRunConfig();
        });
        $el.on('change.statsReport', '#stats-report-exact-checkbox', (e) => {
            this._exactNew = e.target.checked;
            this._saveRunConfig();
        });

        // Category checkboxes. 2026-05-21: dropped jQuery slideToggle in
        // favor of a CSS-only `.is-collapsed` class + max-height
        // transition (see styles.css). Reason: jQuery's slideToggle sets
        // an inline `overflow: hidden` during the animation and removes
        // it at the end, which produced the "weird little section that
        // appears at the end" jump the user kept reporting on the
        // "What to optimize" sub-sections. CSS transitions don't
        // touch overflow at the end of the animation.
        $el.on('change.statsReport', '.stats-report-cat-checkbox', (e) => {
            const cat = $(e.target).data('category');
            if (e.target.checked) {
                this._selectedCategories.add(cat);
            } else {
                this._selectedCategories.delete(cat);
            }
            $el.find(`.stats-report-skill-filter[data-for="${cat}"]`)
                .toggleClass('is-collapsed', !e.target.checked);
            $el.find(`.stats-report-chest-list[data-for="${cat}"]`)
                .toggleClass('is-collapsed', !e.target.checked);
            $el.find(`.stats-report-kind-list[data-for="${cat}"]`)
                .toggleClass('is-collapsed', !e.target.checked);
            // Live-update the "N/5 categories" counter. Previously this only
            // re-rendered on a full page reload, so the count looked stuck.
            $el.find('.stats-report-cat-count')
                .text(`${this._selectedCategories.size}/${CATEGORIES.length} categories`);
            this._updateOptimizeButtonState();
            // Persist to localStorage so the user's category selection
            // survives a reload.
            this._saveRunConfig();
        });

        // Skill chips (toggle selection). Note: chest chips and kind chips
        // use separate handlers below so a non-skill chip class doesn't
        // accidentally mutate _selectedSkills with `undefined`.
        $el.on('click.statsReport', '.stats-report-skill-chip:not(.stats-report-chest-chip):not(.stats-report-kind-chip)', (e) => {
            const $chip = $(e.currentTarget);
            const skill = $chip.data('skill');
            if (!skill) return; // group label rows etc.
            const cat = $chip.data('category');
            const skillSet = this._skillsFor(cat);
            if (skillSet.has(skill)) {
                skillSet.delete(skill);
                $chip.removeClass('selected');
            } else {
                skillSet.add(skill);
                $chip.addClass('selected');
            }
            // Persist after every toggle so the state survives reloads.
            this._saveSelectedSkills();
            // Refresh any group-toggle's all-selected class — the chip
            // we just toggled may have flipped its group's all-or-none
            // state.
            this._refreshGroupToggleStates($chip.closest('.sr-skill-flat-grid'));
        });

        // Chest chips (toggle selection). Default-all + persisted to
        // localStorage, mirroring the skill-chip behavior. Empty
        // selection = "no chests" (the user explicitly turned them all
        // off); a missing key = default-all on first visit.
        $el.on('click.statsReport', '.stats-report-chest-chip', (e) => {
            const $chip = $(e.currentTarget);
            const chest = $chip.data('chest');
            if (!chest) return;
            const cat = $chip.data('category');
            const chestSet = this._chestsFor(cat);
            if (chestSet.has(chest)) {
                chestSet.delete(chest);
                $chip.removeClass('selected');
            } else {
                chestSet.add(chest);
                $chip.addClass('selected');
            }
            this._saveSelectedChests();
            this._refreshGroupToggleStates($chip.closest('.sr-skill-flat-grid'));
        });

        // 2026-05-22 (T17 follow-up): kind chips for "Fastest New Item
        // Activities" sub-filter (gear / tools / eggs / collectibles).
        // Toggle/persist mirrors the chest-chip pattern; no group toggle
        // since there's only one row of 4 chips.
        $el.on('click.statsReport', '.stats-report-kind-chip', (e) => {
            const $chip = $(e.currentTarget);
            const kind = $chip.data('kind-name');
            if (!kind) return;
            if (this._selectedKinds.has(kind)) {
                this._selectedKinds.delete(kind);
                $chip.removeClass('selected');
            } else {
                this._selectedKinds.add(kind);
                $chip.addClass('selected');
            }
            this._saveSelectedKinds();
        });

        // 2026-05-21: clickable group label chips ("Gathering",
        // "Artisan", "Utility", "Misc"). Click toggles select-all /
        // deselect-all of every chip in the group. The chip itself
        // wears `.all-selected` when every chip in its group is
        // currently selected, and lights up with the group's category
        // color via CSS.
        $el.on('click.statsReport', '.sr-skill-group-toggle', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const group = $btn.data('group');
            const kind = $btn.data('kind');
            const $grid = $btn.closest('.sr-skill-flat-grid');
            const cat = $btn.data('category');
            if (kind === 'skill') {
                const groupObj = SKILL_GROUPS.find(g => g.label === group);
                if (!groupObj) return;
                const names = groupObj.skills.map(s => s.name);
                const skillSet = this._skillsFor(cat);
                const allSel = names.every(n => skillSet.has(n));
                names.forEach(n => {
                    if (allSel) skillSet.delete(n);
                    else skillSet.add(n);
                    const $chip = $grid.find(`.stats-report-skill-chip[data-skill="${n}"]`);
                    $chip.toggleClass('selected', !allSel);
                });
                this._saveSelectedSkills();
            } else if (kind === 'chest' || kind === 'chest-misc') {
                // Pull chest names from the rendered chips inside this
                // grid that match the group's chips. Easier than
                // re-deriving from SKILL_GROUPS / MISC_CHESTS here.
                const chests = [];
                if (kind === 'chest-misc') {
                    // Misc group lives at the bottom of the grid — its
                    // chips are the ones AFTER the misc label and have
                    // chest names in MISC_CHESTS.
                    chests.push('Coral chest', 'Rusty chest', 'Sunken chest');
                } else {
                    const groupObj = SKILL_GROUPS.find(g => g.label === group);
                    if (!groupObj) return;
                    for (const s of groupObj.skills) {
                        chests.push(`${s.name} chest`);
                    }
                }
                // Filter to chests actually rendered in this grid (recipes
                // mode may have only Artisan, etc.)
                const renderedNames = $grid.find('.stats-report-chest-chip').map(function () {
                    return $(this).data('chest');
                }).get();
                const groupChests = chests.filter(c => renderedNames.includes(c));
                const chestSet = this._chestsFor(cat);
                const allSel = groupChests.every(c => chestSet.has(c));
                groupChests.forEach(c => {
                    if (allSel) chestSet.delete(c);
                    else chestSet.add(c);
                    const $chip = $grid.find(`.stats-report-chest-chip[data-chest="${c}"]`);
                    $chip.toggleClass('selected', !allSel);
                });
                this._saveSelectedChests();
            }
            this._refreshGroupToggleStates($grid);
        });

        // Optimize All button
        $el.on('click.statsReport', '#stats-report-optimize-btn', () => {
            this._startRun();
        });

        // 2026-06-02 (jwbail): Cancel button. Two-click confirm pattern
        // matching settings-modal's delete-confirm (3-second revert).
        // First click swaps label to "Cancel?" and arms a 3s timer that
        // reverts the label if the user doesn't click again. Second
        // click within the window hits /api/stats-report/cancel which
        // SIGTERMs the worker subprocess and marks the run 'failed'
        // without wiping any results — unlike Reset.
        // Reuses the .cancel-optimize-btn red styling + .confirm-pending
        // pulse animation from the column-3 cancel button (see
        // styles.css ~10179) so users see a consistent Cancel
        // affordance across the app.
        $el.on('click.statsReport', '#stats-report-cancel-btn', async (e) => {
            e.preventDefault();
            const $btn = $el.find('#stats-report-cancel-btn');
            if ($btn.data('confirm-armed')) {
                // Second click — actually cancel.
                clearTimeout($btn.data('confirm-timer'));
                $btn.data('confirm-armed', false);
                $btn.data('confirm-timer', null);
                $btn.prop('disabled', true);
                $btn.removeClass('confirm-pending');
                $btn.text('Cancelling…');
                try {
                    const resp = await fetch('/api/stats-report/cancel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: '{}',
                    });
                    const result = await resp.json();
                    if (result && (result.success || result.no_run)) {
                        // Stop polling and clear local running state so
                        // the UI immediately reflects "not running".
                        // _updateOptimizeButtonRunningState (driven by
                        // _isRunning) re-hides the cancel button + flips
                        // the optimize button back to its idle face.
                        try { this._stopPolling && this._stopPolling(); } catch (_) {}
                        this._isRunning = false;
                        this._hideProgressSection && this._hideProgressSection();
                        this._updateOptimizeButtonRunningState();
                        // Re-fetch status so we pick up the now-failed
                        // run record + any results that did finish before
                        // the SIGTERM. Mirrors what /reset does.
                        try {
                            await this._loadInitialStatus();
                        } catch (_) { /* non-fatal */ }
                        api.showSuccess(
                            'Cancelled. Prior results kept — start a new run anytime.'
                        );
                    } else {
                        api.showError(
                            (result && result.error) || 'Failed to cancel optimization'
                        );
                    }
                } catch (err) {
                    console.warn('[StatsReportPage] cancel failed:', err);
                    api.showError('Failed to cancel optimization');
                }
                // No matter what happens with the API call, the running-
                // state machine reconciles the button via
                // _updateOptimizeButtonRunningState, so we don't need to
                // restore "Cancel" label here.
                return;
            }
            // First click — arm the confirm. Add .confirm-pending so the
            // button pulses red (animation defined in styles.css).
            $btn.text('Cancel?');
            $btn.addClass('confirm-pending');
            $btn.data('confirm-armed', true);
            const t = setTimeout(() => {
                if ($btn.data('confirm-armed')) {
                    $btn.text('Cancel');
                    $btn.removeClass('confirm-pending');
                    $btn.data('confirm-armed', false);
                    $btn.data('confirm-timer', null);
                }
            }, 3000);
            $btn.data('confirm-timer', t);
        });

        // 2026-05-22: debug Reset button. Confirms, hits the new
        // /api/stats-report/reset endpoint, then clears in-page state
        // and re-fetches the (now-empty) status+results to rebuild the
        // UI without a full page reload. Native confirm() — same
        // pattern as reports.js for snapshot deletion.
        $el.on('click.statsReport', '#stats-report-reset-btn', async () => {
            if (!confirm('Emergency reset: only reset if you believe your data is corrupted, because a new fresh optimization can take a while. This deletes all goals report data for this session (results, stale scopes, runs). Character data and gear sets are not affected. Continue?')) {
                return;
            }
            const $btn = $el.find('#stats-report-reset-btn');
            $btn.prop('disabled', true).text('Resetting...');
            try {
                const resp = await fetch('/api/stats-report/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: '{}',
                });
                const result = await resp.json();
                if (result && result.success) {
                    api.showSuccess('Goals report data reset.');
                    // Tear down any in-browser (Pyodide) local run too, so a
                    // later "Continue locally" can't resume the pre-reset
                    // browser session's work. Terminates the shard-worker pool
                    // and clears active-run tracking.
                    try { resetLocalGoalsReport(); } catch (_) {}
                    // Clear all in-page state. Avoids window.location.reload()
                    // which loses the user's scroll position, expanded panels,
                    // and reloads every other column for no benefit.
                    try { this._stopPolling && this._stopPolling(); } catch (_) {}
                    this._isRunning = false;
                    this._localRunActive = false;
                    this._runId = null;
                    this._totalJobs = 0;
                    this._completedJobs = 0;
                    this._startedAt = null;
                    this._results = {};
                    this._alteredRows = new Map();
                    this._staleDismissed = false;
                    // Hide running banners and stale banner.
                    this._hideProgressSection && this._hideProgressSection();
                    this._$el.find('#stats-report-stale-banner').hide();
                    // Return the Optimize All button to its idle, ENABLED
                    // state. A reset performed MID-RUN leaves the button in its
                    // disabled "Optimizing…" render (rendered-running=true);
                    // we just set _isRunning=false but never re-rendered it, so
                    // the next click landed on a disabled button and did
                    // nothing until a page reload re-rendered it (user-reported:
                    // "reset then Optimize All does nothing; refresh fixes it").
                    // _updateNavIconState('idle') transitively calls
                    // _updateOptimizeButtonRunningState (idle render +
                    // re-enable via _updateOptimizeButtonState) and clears the
                    // nav spinner.
                    try { this._updateNavIconState('idle'); } catch (_) {}
                    // Re-render the (now-empty) results region. _renderResults
                    // handles the empty state — same path the page hits on
                    // first open before any run completes.
                    this._renderResults();
                    // Reset annotator badges (red ! on nav + per-skill chips)
                    // by firing the stale-detection refresh event.
                    try {
                        window.dispatchEvent(new CustomEvent('stats-report-stale-refresh'));
                    } catch (_) {}
                    $btn.prop('disabled', false).text('Reset');
                } else {
                    api.showError((result && result.error) || 'Reset failed');
                    $btn.prop('disabled', false).text('Reset');
                }
            } catch (e) {
                console.error('[StatsReportPage] reset failed', e);
                api.showError('Reset failed: ' + (e && e.message ? e.message : 'network error'));
                $btn.prop('disabled', false).text('Reset');
            }
        });

        // Stale banner buttons
        $el.on('click.statsReport', '.stats-report-keep-btn', () => {
            this._staleDismissed = true;
            $el.find('#stats-report-stale-banner').hide();
            if (this._runId) {
                localStorage.setItem(`stats_report_stale_dismissed_${this._runId}`, '1');
            }
        });

        $el.on('click.statsReport', '.stats-report-rerun-btn', () => {
            $el.find('#stats-report-stale-banner').hide();
            $el.find('#stats-report-config')[0]?.scrollIntoView({ behavior: 'smooth' });
            $el.find('#stats-report-optimize-btn').addClass('stats-report-highlight');
            setTimeout(() => $el.find('#stats-report-optimize-btn').removeClass('stats-report-highlight'), 2000);
        });

        // ---- Result row button handlers (event delegation) ----
        // Using delegation on $el so handlers survive _renderResults() re-renders.

        $el.on('click.statsReport', '.stats-report-save-btn', (e) => {
            const $btn = $(e.currentTarget);
            const resultId = $btn.data('result-id');
            this._saveGearset(resultId, $btn);
        });

        $el.on('click.statsReport', '.stats-report-equip-btn', (e) => {
            const $btn = $(e.currentTarget);
            const resultId = $btn.data('result-id');
            this._equipResult(resultId, $btn);
        });

        $el.on('click.statsReport', '.stats-report-gear-toggle-btn', (e) => {
            const $btn = $(e.currentTarget);
            const resultId = $btn.data('result-id');
            this._toggleGearPreview(resultId, $btn);
        });

        // 2026-05-21: in-place gear-slot picker. Click a slot tile inside
        // a row's gear preview to open the same popup the column-2 path
        // uses, scoped to that row's context (activity skill, current
        // gearset). On select we LOCALLY update the row's slots, recalc
        // the metric via /api/stats-report/recalc-row, and add an
        // asterisk to the pill — without re-running the optimizer or
        // changing the row's rank position.
        $el.on('click.statsReport', '.stats-report-gear-preview-container .tree-gear-mini-slot', (e) => {
            e.stopPropagation();
            const $tile = $(e.currentTarget);
            // Defensive: level-locked tool slots are non-interactive. The
            // tree-node click handler does the same bail; mirror it.
            if ($tile.attr('data-disabled') === '1') return;
            const slot = $tile.data('slot');
            if (!slot) return;
            const $container = $tile.closest('.stats-report-gear-preview-container');
            const resultId = $container.data('result-id');
            if (!resultId) return;
            this._handleSlotClick(resultId, slot);
        });

        $el.on('click.statsReport', '.stats-report-run-skill-btn', (e) => {
            const $btn = $(e.currentTarget);
            const skill = $btn.data('skill');
            const category = $btn.data('category');
            this._mergeSkill(skill, category);
        });

        // 2026-05-25: hide-new-item button on new_items rows. Two-click
        // confirm pattern (matches the delete-confirm UX used elsewhere
        // in the app — e.g. settings-modal color-preset deletion,
        // travel-region-card reset). First click swaps the button text
        // to "Hide?" with the .delete-confirm class; second click within
        // 3 seconds actually hides; otherwise the button reverts.
        //
        // Hidden items: write user_overrides.items.<itemId>.hide=true
        // via the store (same path column-1's hide checkbox uses), then
        // locally drop the row so the section reflows immediately.
        // Toast tells the user how to un-hide via column 1's eye icon.
        if (!this._hidePendingByResultId) {
            this._hidePendingByResultId = new Map();
        }
        $el.on('click.statsReport', '.stats-report-hide-new-item-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const itemName = $btn.data('item-name') || '';
            const itemRef = $btn.data('item-ref') || '';
            const resultId = String($btn.data('result-id') || '');
            if (!itemRef || !resultId) return;

            const pendingMap = this._hidePendingByResultId;
            const pending = pendingMap.get(resultId);
            if (!pending) {
                // First click — arm the confirm. Visually shift to a
                // "Hide?" state and queue a 3s revert.
                $btn.addClass('delete-confirm');
                $btn.find('.stats-report-hide-label').text('Hide?');
                const timer = setTimeout(() => {
                    if (pendingMap.get(resultId) !== entry) return;
                    pendingMap.delete(resultId);
                    $btn.removeClass('delete-confirm');
                    $btn.find('.stats-report-hide-label').text('Hide');
                }, 3000);
                const entry = { timer };
                pendingMap.set(resultId, entry);
                return;
            }

            // Second click within the 3s window — perform the hide.
            clearTimeout(pending.timer);
            pendingMap.delete(resultId);

            // Convention: Item.PARKOUR_GLOVES → 'parkour_gloves'
            const refParts = String(itemRef).split('.');
            const itemId = refParts.length === 2
                ? String(refParts[1]).toLowerCase()
                : String(itemRef).toLowerCase();

            try {
                store.update(`ui.user_overrides.items.${itemId}.hide`, true);
            } catch (_e) {
                console.warn('[StatsReportPage] hide store.update failed:', _e);
            }
            // Drop the row from the current report so the user sees the
            // section reflow without waiting for a rerun.
            for (const cat of Object.keys(this._results || {})) {
                if (cat !== 'new_items') continue;
                this._results[cat] = (this._results[cat] || []).filter(
                    r => String(r.id) !== resultId
                );
            }
            this._renderResults();
            try {
                api.showSuccess(
                    `Hidden "${itemName}". To un-hide, click the eye icon next to the item in your owned items list (column 1).`
                );
            } catch (_) {}
        });

        // 2026-06-17: "Already done" button on single-completion activity
        // rows (currently just "Repair the bank"). Mirrors the hide-new-item
        // two-click confirm. On confirm we persist the completion as a custom
        // stat (same path the Custom Stats popup writes) so the next run's
        // is_unlocked() drops the activity, AND we locally remove every row
        // for that activity across all sections (XP / chests / new items) so
        // the report reflows immediately. Undo is via the Custom Stats popup.
        if (!this._alreadyDonePendingByResultId) {
            this._alreadyDonePendingByResultId = new Map();
        }
        $el.on('click.statsReport', '.stats-report-already-done-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const statId = $btn.data('stat-id');
            const activityName = $btn.data('activity-name') || '';
            const resultId = String($btn.data('result-id') || '');
            if (!statId) return;

            const pendingMap = this._alreadyDonePendingByResultId;
            const pending = pendingMap.get(resultId);
            if (!pending) {
                // First click — arm the confirm.
                $btn.addClass('delete-confirm');
                $btn.find('.stats-report-already-done-label').text('Already done?');
                const timer = setTimeout(() => {
                    if (pendingMap.get(resultId) !== entry) return;
                    pendingMap.delete(resultId);
                    $btn.removeClass('delete-confirm');
                    $btn.find('.stats-report-already-done-label').text('Already done');
                }, 3000);
                const entry = { timer };
                pendingMap.set(resultId, entry);
                return;
            }

            // Second click within the 3s window — persist + drop rows.
            clearTimeout(pending.timer);
            pendingMap.delete(resultId);

            try {
                if (!store.state.ui.custom_stats) {
                    store.state.ui.custom_stats = {};
                }
                store.state.ui.custom_stats[statId] = true;
                store.update(`ui.custom_stats.${statId}`, true);
            } catch (_e) {
                console.warn('[StatsReportPage] already-done store.update failed:', _e);
            }

            // Drop every row for this activity across all sections so the
            // report reflows without waiting for a rerun.
            for (const cat of Object.keys(this._results || {})) {
                this._results[cat] = (this._results[cat] || []).filter(
                    r => (r.activity_name || '') !== activityName
                );
            }
            this._renderResults();
            try {
                api.showSuccess(
                    `Marked "${activityName}" as already done — removed from the goals report. To undo, open Custom Stats and turn off "Has Repaired the Bank at Wraithwater".`
                );
            } catch (_) {}
        });

        // ---- Hierarchy collapse/expand handlers ----

        // Per-category Reset button (in each section header). Scoped sibling
        // of the global Emergency reset: clears ONLY this category's saved
        // results so it recomputes fresh on the next run, leaving every
        // other category's cached results intact. stopPropagation keeps the
        // click from also toggling the section's collapse state.
        $el.on('click.statsReport', '.stats-report-section-reset-btn', async (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const category = $btn.data('category');
            if (!category) return;
            const catLabel = (CATEGORIES.find(c => c.key === category) || {}).label || category;
            if (!confirm(`Emergency reset "${catLabel}": only reset if you believe this category's data is corrupted, because a fresh optimization can take a while. This deletes the saved goals report data for "${catLabel}" (results, stale scopes). Other categories, character data, and gear sets are not affected. Continue?`)) {
                return;
            }
            $btn.prop('disabled', true).text('Resetting...');
            try {
                const resp = await fetch('/api/stats-report/reset-category', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ category }),
                });
                const result = await resp.json();
                if (result && result.success) {
                    api.showSuccess(`"${catLabel}" reset. Re-run it to rebuild.`);
                    // Drop just this category's in-memory rows and re-render so
                    // the section disappears until the user re-runs it. Other
                    // categories' results stay on screen.
                    if (this._results) this._results[category] = [];
                    this._renderResults();
                    // Refresh the stale badges (nav ! + per-skill chips) so the
                    // category shows as needing a run again.
                    try {
                        window.dispatchEvent(new CustomEvent('stats-report-stale-refresh'));
                    } catch (_) {}
                } else {
                    api.showError((result && result.error) || 'Category reset failed');
                }
            } catch (err) {
                console.error('[StatsReportPage] category reset failed', err);
                api.showError('Category reset failed: ' + (err && err.message ? err.message : 'network error'));
            } finally {
                $btn.prop('disabled', false).text('Reset');
            }
        });

        // Section header (e.g. Best XP / Best Coins) — collapse the whole
        // results card. We toggle the .open class + slideToggle the body
        // and persist the new state to localStorage so refreshes preserve
        // the user's layout choices.
        $el.on('click.statsReport', '.stats-report-section-header', (e) => {
            const $header = $(e.currentTarget);
            const $section = $header.closest('.stats-report-section');
            const sectionId = $header.data('section');
            const key = `section:${sectionId}`;
            const willOpen = !this._isExpanded(key);
            this._setExpanded(key, willOpen);
            $section.toggleClass('open', willOpen);
            const $secBody = $section.find('> .stats-report-section-body');
            // While slideToggle clips the body with overflow:hidden, any
            // sticky descendant header (cat / skill / chest) is constrained
            // inside the short clipped box and then SNAPS to its real position
            // when overflow is released at the end — the "pop" the user saw.
            // Mark the group as toggling so CSS drops those headers to
            // position:static for the duration; they flow at their final
            // position the whole time (no snap), and sticky pinning resumes
            // once the class is removed.
            $section.addClass('stats-report-toggling');
            $secBody.slideToggle(150, () => {
                $section.removeClass('stats-report-toggling');
            });
        });

        // "What to optimize" config card collapse — uses the same arrow
        // pattern as the result sections so the chevron is consistent.
        // 2026-05-21: dropped jQuery slideToggle here too. The card's
        // `.open` class is already used by other CSS rules (the chevron
        // rotation, the collapsed-padding hug, etc.) — we now also drive
        // a CSS max-height transition off it for the body. Avoids the
        // overflow:hidden jump at the end of jQuery animations.
        $el.on('click.statsReport', '.stats-report-config-header', (e) => {
            const $header = $(e.currentTarget);
            const $card = $header.closest('.stats-report-config-card');
            const which = $header.data('config-section');
            const key = `config:${which}`;
            const willOpen = !this._isExpanded(key);
            this._setExpanded(key, willOpen);
            $card.toggleClass('open', willOpen);
            // Body shows / hides via CSS rule keyed off .open — no JS
            // animation here. The body element keeps display:block at
            // all times; max-height + opacity drive the visible state.
        });

        // Side-collapse strip — colored 9px bar pinned to the left edge of
        // each cat-group / skill-group. Mirrors the crafting tree's
        // .tree-node-side-collapse: clicking the bar toggles the same
        // collapse as the header. The bar itself glows on hover (CSS-only).
        // We synthesize a click on the matching header so all the existing
        // header-click logic runs unchanged (state persistence + animation).
        $el.on('click.statsReport', '.stats-report-side-collapse', (e) => {
            e.stopPropagation();
            const $strip = $(e.currentTarget);
            const target = $strip.data('target'); // 'cat-group' or 'skill-group'
            const $group = $strip.closest(target === 'cat-group'
                ? '.stats-report-cat-group' : '.stats-report-skill-group');
            const headerSel = target === 'cat-group'
                ? '.stats-report-cat-header' : '.stats-report-skill-header';
            $group.find(`> ${headerSel}`).first().trigger('click.statsReport');
        });

        // Category-group header (Gathering / Artisan / Utility)
        $el.on('click.statsReport', '.stats-report-cat-header', (e) => {
            const $header = $(e.currentTarget);
            const $group = $header.closest('.stats-report-cat-group');
            const sectionId = $header.data('section');
            const catGroup = $header.data('cat-group');
            const key = `category:${sectionId}:${catGroup}`;
            const willOpen = !this._isExpanded(key);
            this._setExpanded(key, willOpen);
            $group.toggleClass('open', willOpen);
            $group.addClass('stats-report-toggling');
            $group.find('> .stats-report-cat-body').slideToggle(150, () => {
                $group.removeClass('stats-report-toggling');
            });
        });

        // Skill / Chest header — second-level grouping inside a category.
        $el.on('click.statsReport', '.stats-report-skill-header', (e) => {
            const $header = $(e.currentTarget);
            const $group = $header.closest('.stats-report-skill-group');
            const sectionId = $header.data('section');
            const skillName = $header.data('skill-group');
            const chestName = $header.data('chest-group');
            const subKey = skillName ? `skill:${sectionId}:${skillName}`
                                     : `chest:${sectionId}:${chestName}`;
            const willOpen = !this._isExpanded(subKey);
            this._setExpanded(subKey, willOpen);
            $group.toggleClass('open', willOpen);
            const $skBody = $group.find('> .stats-report-skill-body');
            $group.addClass('stats-report-toggling');
            $skBody.slideToggle(150, () => {
                $group.removeClass('stats-report-toggling');
            });
        });

        // "Show more" / "Show less" — reveals the 2nd–Nth ranked rows
        // within a skill or chest group. State is in-memory only (per-session)
        // since the user might want fresh-default behavior on a new run.
        // Arrow rotation is CSS-driven (.open class) so no innerHTML swap;
        // only the label text changes — keeps the chevron animation smooth.
        $el.on('click.statsReport', '.stats-report-show-more-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const sectionId = $btn.data('section');
            const skillName = $btn.data('skill-group');
            const chestName = $btn.data('chest-group');
            const subKey = `${sectionId}::${skillName || chestName}`;
            const willExpand = !this._showMoreExpanded.has(subKey);
            if (willExpand) this._showMoreExpanded.add(subKey);
            else this._showMoreExpanded.delete(subKey);
            const $extras = $btn.closest('.stats-report-skill-body')
                .find(`.stats-report-skill-extras[data-section="${sectionId}"][data-${skillName ? 'skill' : 'chest'}-group="${skillName || chestName}"]`);
            $extras.slideToggle(150);
            $btn.toggleClass('open', willExpand);
            // Update label text only (arrow stays put — CSS rotates it).
            const restCount = $extras.children().length;
            $btn.find('.stats-report-show-more-label').text(
                willExpand ? 'Show less' : `Show ${restCount} more`
            );
        });
    }

    _updateOptimizeButtonState() {
        const $btn = this._$el.find('#stats-report-optimize-btn');
        const $msg = this._$el.find('#stats-report-no-cat-msg');
        if (this._selectedCategories.size === 0) {
            $btn.prop('disabled', true);
            $msg.show();
        } else {
            $btn.prop('disabled', false);
            $msg.hide();
        }
    }

    /**
     * 2026-06-02 (jwbail): swap the Optimize All button's icon + label
     * to the rotating hourglass while a run is in progress, mirroring
     * the column-2 / crafting-tree optimize buttons. Idempotent — safe
     * to call from poll updates without thrashing the DOM.
     */
    _updateOptimizeButtonRunningState() {
        const $btn = this._$el.find('#stats-report-optimize-btn');
        if (!$btn.length) return;
        const running = !!this._isRunning;
        if (running === !!$btn.data('rendered-running')) return;
        $btn.data('rendered-running', running);
        // 2026-06-02 (jwbail): mirror the running state onto the
        // Cancel button — visible only while a run is in progress.
        // If the user navigates away and back during a run, the
        // status poll re-flips _isRunning=true and this re-shows
        // the button. Reset confirm-armed state so a stale "Cancel?"
        // label from a previous run doesn't carry over.
        const $cancelBtn = this._$el.find('#stats-report-cancel-btn');
        if ($cancelBtn.length) {
            // Always reset to the idle "Cancel" label whenever the
            // running state transitions — the click handler restores
            // it on a 3s timer, but a state flip should immediately
            // win.
            const cancelTimer = $cancelBtn.data('confirm-timer');
            if (cancelTimer) clearTimeout(cancelTimer);
            $cancelBtn.data('confirm-armed', false);
            $cancelBtn.data('confirm-timer', null);
            $cancelBtn.removeClass('confirm-pending');
            $cancelBtn.text('Cancel');
            $cancelBtn.prop('disabled', false);
            if (running) {
                $cancelBtn.show();
            } else {
                $cancelBtn.hide();
            }
        }
        if (running) {
            $btn.html(`
                <span class="spinner" style="display:inline-block;margin-right:6px">⏳</span>
                Optimizing…
            `);
            $btn.prop('disabled', true);
        } else {
            $btn.html(`
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:6px">
                    <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                Optimize All
            `);
            // Re-evaluate disabled state from selected-categories count.
            this._updateOptimizeButtonState();
        }
    }

    // ========================================================================
    // PUSH NOTIFICATION AFFORDANCE (banner vs checkbox)
    // ========================================================================

    /**
     * 2026-06-02 (jwbail): mirrors the bug-report "Enable Notifications"
     * block. When push isn't granted yet and the user hasn't dismissed,
     * we render an inline banner with an Enable button + description;
     * otherwise we either render the regular "Push notification when
     * done" checkbox (if granted) or hide the whole row (if dismissed
     * / unsupported / iOS non-PWA). User-reported pain: a checkbox the
     * user can't actually use because push isn't enabled is confusing.
     */
    _renderPushNotifySection() {
        const supported = this._pushSupported();
        const iosNonPwa = this._isIosNonPwa();
        const dismissed = this._isPushNotifyDismissed();
        const permission = (typeof Notification !== 'undefined')
            ? Notification.permission : 'denied';

        // Hidden entirely: no support, iOS non-PWA, dismissed, or denied.
        if (!supported || iosNonPwa || dismissed || permission === 'denied') {
            return '';
        }

        if (permission === 'granted') {
            // Already granted — show the simple checkbox row.
            return `
                <div class="stats-report-toggle-row">
                    <label class="stats-report-notify-row" title="In-app toast always shown. This controls push notifications.">
                        <input type="checkbox" id="stats-report-notify-checkbox" ${this._notifyOnComplete ? 'checked' : ''} />
                        <span>Push notification when done</span>
                    </label>
                </div>
            `;
        }

        // permission === 'default' (or anything else not handled above):
        // banner with Enable button + permanent dismiss X.
        return `
            <div class="stats-report-notify-banner" id="stats-report-notify-banner"
                 style="position:relative;display:flex;flex-direction:column;gap:8px;padding:12px 36px 12px 14px;margin-bottom:10px;border:1px solid var(--border-color, #444);border-radius:6px;background:var(--bg-secondary, #1f2530)">
                <button type="button" class="stats-report-notify-dismiss" id="stats-report-notify-dismiss"
                        aria-label="Dismiss notifications prompt"
                        title="Don't show this again"
                        style="position:absolute;top:6px;right:8px;width:22px;height:22px;line-height:1;font-size:18px;background:transparent;border:none;color:var(--text-muted,#888);cursor:pointer;padding:0">&times;</button>
                <p style="margin:0;font-size:0.95em;color:var(--text-primary)"><strong>Get a notification when your goals report finishes.</strong></p>
                <button type="button" class="button button-primary" id="stats-report-enable-notifications"
                        style="align-self:flex-start;font-size:0.95em">
                    🔔 Enable Notifications
                </button>
                <p style="margin:0;font-size:0.85em;color:var(--text-muted,#888)">These options are under Settings &rsaquo; Personalization and can be turned off at any time.</p>
            </div>
        `;
    }

    _pushSupported() {
        try {
            return 'serviceWorker' in navigator && 'PushManager' in window;
        } catch (_) {
            return false;
        }
    }

    _isIosNonPwa() {
        try {
            const ua = navigator.userAgent || '';
            const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
            const isPwa = window.navigator.standalone === true
                || window.matchMedia('(display-mode: standalone)').matches;
            return isIos && !isPwa;
        } catch (_) { return false; }
    }

    _isPushNotifyDismissed() {
        try {
            if (window.store?.state?.ui?.goalsReportNotifyDismissed) return true;
        } catch (_) { /* noop */ }
        try {
            return localStorage.getItem('goalsReportNotifyDismissed') === '1';
        } catch (_) {
            return false;
        }
    }

    _persistPushNotifyDismissed() {
        try { localStorage.setItem('goalsReportNotifyDismissed', '1'); } catch (_) {}
        try { window.store.state.ui.goalsReportNotifyDismissed = true; } catch (_) {}
        try {
            const uuid = window.store?.state?.session?.uuid;
            if (uuid && window.api?.updateConfig) {
                window.api.updateConfig(uuid, 'ui.goalsReportNotifyDismissed', true);
            }
        } catch (_) {}
    }

    /**
     * Click handler for the Enable Notifications button. Reuses the
     * settings modal's push init flow so prefs/subscription stay
     * consistent with the Personalization tab.
     */
    async _handleEnableNotificationsClick() {
        const $btn = this._$el.find('#stats-report-enable-notifications');
        $btn.prop('disabled', true).text('Setting up notifications…');
        try {
            if (window.settingsModal && typeof window.settingsModal._initPushNotifications === 'function') {
                window.settingsModal._pushPermission = 'granted';
                await window.settingsModal._initPushNotifications();
            } else {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    // Re-render to reflect denied state.
                    this._refreshPushNotifySection();
                    return;
                }
            }
        } catch (err) {
            console.error('[StatsReportPage] Failed to enable notifications:', err);
        }
        this._refreshPushNotifySection();
    }

    /**
     * Re-render the push notify section in place (without nuking the
     * rest of the page). Called after Enable / Dismiss clicks.
     */
    _refreshPushNotifySection() {
        const $row = this._$el.find('.stats-report-action-row');
        if (!$row.length) return;
        // The section is the first child of the action row by convention.
        const banner = this._$el.find('#stats-report-notify-banner');
        const checkboxRow = this._$el.find('#stats-report-notify-checkbox').closest('.stats-report-toggle-row');
        if (banner.length) banner.remove();
        if (checkboxRow.length) checkboxRow.remove();
        const html = this._renderPushNotifySection();
        if (html) $row.prepend(html);
    }

    // ========================================================================
    // RUN MANAGEMENT
    // ========================================================================

    async _startRun() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        // One-time nudge if this device benchmarked faster than the server.
        try { await maybeShowLocalSpeedWarning(); } catch (_) { /* non-fatal */ }

        const categories = Array.from(this._selectedCategories);
        const kinds = Array.from(this._selectedKinds);
        // 2026-06-16 (jwbail): per-category skill/chest selections. XP and
        // Coins keep independent skill picks; Chests (activities) and
        // Chests-recipes keep independent chest picks. The worker applies each
        // category's own list. Flat `skills`/`chests` are the union, used as
        // the default for any non-per-category consumer (precount/merge).
        const skillsByCategory = {};
        for (const c of SKILL_CHIP_CATEGORIES) skillsByCategory[c] = Array.from(this._skillsFor(c));
        const chestsByCategory = {};
        for (const c of CHEST_CHIP_CATEGORIES) chestsByCategory[c] = Array.from(this._chestsFor(c));
        const skills = Array.from(new Set([].concat(...Object.values(skillsByCategory))));
        const chests = Array.from(new Set([].concat(...Object.values(chestsByCategory))));

        // UI polish (2026-05-22, fixed 2026-05-26):
        //  1. Add loading spinner to the Optimize button so user gets feedback.
        //  2. Collapse the WTO config panel so the progress section is the focus.
        // The earlier code referenced `#stats-report-start-btn` and
        // `#stats-report-config` — neither exists in this page (button id
        // is #stats-report-optimize-btn, the WTO is .stats-report-config-card
        // toggled via .open class). The selectors are corrected here.
        const $optimizeBtn = this._$el.find('#stats-report-optimize-btn').first();
        if ($optimizeBtn.length) {
            $optimizeBtn.prop('disabled', true);
            $optimizeBtn.data('originalText', $optimizeBtn.html());
            // Hourglass spinner — matches the pattern used elsewhere in the
            // app for "starting" actions. The animation reuses the existing
            // stats-report-spin keyframes from styles.css.
            $optimizeBtn.html(
                '<span class="stats-report-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:stats-report-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"></span>'
                + 'Starting…'
            );
        }
        // Collapse the WTO config card so progress is immediately visible.
        // Same expanded-state machinery the user uses to manually collapse
        // the section, so it persists and re-opens via the header on
        // demand. _setExpanded handles localStorage; toggling .open
        // triggers the CSS max-height/opacity transition.
        const $wtoCard = this._$el.find('.stats-report-config-card').first();
        if ($wtoCard.length && $wtoCard.hasClass('open')) {
            this._setExpanded('config:what-to-optimize', false);
            $wtoCard.removeClass('open');
        }
        try {
            // Stats-report stale-detection: ALWAYS pass stale_only=true.
            // The worker filters to stale + newly-unlocked scopes only.
            // - First run: stats_report_results is empty → all configured scopes
            //   are "newly_unlocked" → all run.
            // - Subsequent run, nothing changed: 0 stale + 0 newly_unlocked → 0 jobs run
            //   (UI shows "nothing to update" instead of re-grinding all 808).
            // - Subsequent run, something changed: only the changed scopes rerun.
            //
            // To force a full rerun (e.g. for debugging), the user can clear
            // stats_report_results manually OR a future "Force full rerun"
            // override button can pass stale_only=false explicitly.
            const staleOnly = true;
            const result = await api.startStatsReportRun(uuid, categories, skills, this._notifyOnComplete, {
                include_pets: this._includePets,
                include_consumables: this._includeConsumables,
                stale_only: staleOnly,
                kinds: kinds,
                chests: chests,
                skills_by_category: skillsByCategory,
                chests_by_category: chestsByCategory,
                fast: !!this._fast,
                ...(uuid === '00000000-0000-0000-0000-000000000000' ? { exact_new: !!this._exactNew } : {}),
            });
            if (!result.success) {
                api.showError(result.error || 'Failed to start optimization run');
                return;
            }
            this._runId = result.run_id;
            this._isRunning = true;
            this._totalJobs = result.total_jobs || 0;
            this._completedJobs = 0;
            this._startedAt = new Date().toISOString();
            this._pollFailures = 0;
            this._lastProgressAt = Date.now();
            // Clear any prior run-summary banner as a new run starts.
            try { this._$el.find('#stats-report-run-summary').hide().text(''); } catch (_) {}
            // 2026-06-11 (jwbail): do NOT wipe this._results here. Results
            // are now ADDITIVE — a stale_only re-run only recomputes the
            // changed scopes, and the /results endpoint returns the latest
            // row per scope across all runs. Keeping the existing rows
            // displayed means the report stays populated during the run
            // (prior behavior blanked it until the run finished). The
            // first poll merges the fresh additive set in.

            this._updateNavIconState('running');
            this._showProgressSection();
            this._startPolling();
        } catch (err) {
            api.showError('Failed to start optimization run');
        } finally {
            // Restore the Optimize button ONLY if the run did NOT start
            // (handshake failed / no run). When a run IS in progress,
            // _updateOptimizeButtonRunningState (via _updateNavIconState
            // 'running' above) already swapped the button to the ⏳
            // "Optimizing…" spinner AND set its rendered-running guard —
            // restoring the original "Optimize All" text here would clobber
            // that spinner, and the guard then blocks poll ticks from
            // re-rendering it, so the button wrongly showed a STATIC
            // "Optimize All" for the whole first run (only a page reload,
            // which goes through _loadInitialStatus, picked up the spinner).
            // This was the long-standing "no loading icon on first press"
            // report. Leave the running render untouched when _isRunning.
            const $optimizeBtn2 = this._$el.find('#stats-report-optimize-btn').first();
            if (!this._isRunning) {
                const originalText = $optimizeBtn2.data('originalText');
                if (originalText) {
                    $optimizeBtn2.html(originalText);
                }
            }
        }
    }

    async _loadInitialStatus() {
        const uuid = store.state.session?.uuid;
        if (!uuid) {
            this._hideInitialLoading();
            return;
        }
        // 2026-07-06 (jwbail) bug d8f4ea98: track whether we reached a
        // definitive server answer. On a dropped fetch (mobile tab freeze) we
        // deliberately DON'T hide the loader in finally, so the retry /
        // visibilitychange recovery can resolve it instead of leaving a blank
        // report that needs a manual refresh.
        let settled = false;
        try {
            const status = await api.getStatsReportStatus(uuid);
            if (!status.success || !status.run_id) {
                settled = true;
                this._hideInitialLoading();
                return;
            }

            this._runId = status.run_id;
            this._totalJobs = status.total_jobs || 0;
            this._completedJobs = status.completed_jobs || 0;
            this._startedAt = status.started_at;

            if (status.status === 'running') {
                this._isRunning = true;
                this._showProgressSection();
                this._startPolling();
                // 2026-06-02 (jwbail) Issue 4: when arriving at the
                // goals report page while a run is already in progress,
                // the optimize button must immediately swap to the
                // hourglass + disabled state instead of waiting for
                // the next poll tick. Without this explicit call,
                // _pollProgress only triggers the running-state UI
                // after its first interval (~2 s), so the user briefly
                // sees a clickable Optimize All on a running report.
                // _updateNavIconState('running') transitively calls
                // _updateOptimizeButtonRunningState (and reveals the
                // Cancel button via the same machine).
                this._updateNavIconState('running');
            } else {
                // Any terminal status: 'complete', 'failed', or
                // 'interrupted'. 2026-06-24 (jwbail): a failed or
                // interrupted run PRESERVES its persisted results — the
                // cancel/interrupt/SIGTERM paths keep stats_report_results
                // rows (only Reset wipes them). Previously ONLY the
                // 'complete' branch loaded + rendered those rows, so a user
                // whose last run ended 'failed'/'interrupted' (e.g. a deploy
                // 502 or SIGTERM mid-run — note its run counts can even go
                // corrupt, completed>total) returned to a BLANK report and
                // had to regenerate every time (bug 026c1737). Load + render
                // any preserved results for every terminal status, then drop
                // to idle so they can re-run if they want.
                this._isRunning = false;
                this._updateNavIconState('idle');
                const results = await api.getStatsReportResults(uuid);
                if (results.success) {
                    this._results = results.results || {};
                    this._renderResults();
                }
                // Surface the stale banner if the server flagged staleness
                // and the user hasn't dismissed it for this run.
                if (status.is_stale && !this._staleDismissed &&
                    !localStorage.getItem(`stats_report_stale_dismissed_${this._runId}`)) {
                    this._$el.find('#stats-report-stale-banner').show();
                }
            }
            // Reached a definitive answer (a running run, or a terminal run
            // whose results loaded). Safe to clear the loader in finally.
            settled = true;
        } catch (err) {
            console.warn('[StatsReportPage] Failed to load initial status:', err);
            // 2026-07-06 (jwbail) bug d8f4ea98: on mobile, backgrounding the
            // browser can drop the in-flight status/results fetch. Keep the
            // "Loading your last run…" indicator visible and auto-retry once
            // so returning to the tab self-heals instead of showing a blank
            // report that only a manual refresh recovered.
            this._initialLoadFailed = true;
            if (!this._initialLoadRetryScheduled) {
                this._initialLoadRetryScheduled = true;
                setTimeout(() => {
                    this._initialLoadRetryScheduled = false;
                    const hasResults = this._results &&
                        Object.keys(this._results).length > 0;
                    if (this._isPageOpen && !this._isRunning && !hasResults) {
                        this._loadInitialStatus();
                    }
                }, 1500);
            }
        } finally {
            // 2026-05-26 (jwbail): hide the initial loading indicator once
            // we've reached a definitive server answer — the empty-state
            // (no rows, optimize button visible) is the user's signal then.
            // 2026-07-06 (jwbail) bug d8f4ea98: but on a dropped fetch
            // (settled=false) keep it visible so the retry / visibility
            // recovery resolves it, not a blank page that needs a refresh.
            if (settled) {
                this._initialLoadFailed = false;
                this._hideInitialLoading();
            }
        }
    }

    _hideInitialLoading() {
        const $el = this._$el && this._$el.find && this._$el.find('#stats-report-initial-loading');
        if ($el && $el.length) $el.hide();
    }

    // 2026-07-06 (jwbail) bug d8f4ea98: re-show the "Loading your last run…"
    // indicator when the visibilitychange / pageshow recovery re-triggers an
    // initial load, so the user gets feedback instead of a blank page while
    // the re-fetch runs.
    _showInitialLoading() {
        const $el = this._$el && this._$el.find && this._$el.find('#stats-report-initial-loading');
        if ($el && $el.length) $el.show();
    }

    // ========================================================================
    // POLLING
    // ========================================================================

    _startPolling() {
        this._stopPolling();
        this._pollInterval = setInterval(() => this._pollProgress(), POLL_INTERVAL_MS);
        // Also start elapsed timer
        this._startElapsedTimer();
    }

    _stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this._stopElapsedTimer();
    }

    _startElapsedTimer() {
        this._stopElapsedTimer();
        this._elapsedInterval = setInterval(() => this._updateElapsedDisplay(), 1000);
    }

    _stopElapsedTimer() {
        if (this._elapsedInterval) {
            clearInterval(this._elapsedInterval);
            this._elapsedInterval = null;
        }
    }

    async _pollProgress() {
        // Guard: if polling was stopped (run completed or page closed),
        // ignore this stale callback to prevent re-rendering over user actions.
        if (!this._pollInterval) return;

        const uuid = store.state.session?.uuid;
        if (!uuid) return;

        try {
            // Fetch only the tiny /status payload every tick — it drives the
            // progress bar. The (potentially multi-MB) results payload is
            // fetched separately below, and only when new scopes have actually
            // completed (throttled), so a long run no longer transfers hundreds
            // of MB by re-pulling the full results set every 3s.
            const status = await api.getStatsReportStatus(uuid);

            // Re-check after await — polling may have been stopped while we waited
            if (!this._pollInterval) return;

            this._pollFailures = 0;

            if (!status.success) return;

            // 2026-06-16 (jwbail): reconcile to the LATEST run. After a local-run
            // interruption + resume / finish-on-server, the server's latest run
            // can be a NEW run id (the remaining stale scopes run as a fresh
            // run). Keeping the old _runId + monotonic _completedJobs made the
            // bar show stale counts (the interrupted 22 carried into a new
            // 8-job run) and let "Finishing…" stick. Adopt the new id and reset
            // the completed counter so the bar reflects the current run.
            if (status.run_id && this._runId && status.run_id !== this._runId) {
                this._runId = status.run_id;
                this._completedJobs = 0;
                this._localRunActive = false;  // a server-side run owns it now
            } else if (status.run_id && !this._runId) {
                this._runId = status.run_id;
            }

            const prevCompleted = this._completedJobs;
            // Use the server's authoritative job count directly — the worker
            // lowers it from the precount (e.g. 35) to the stale-filtered count
            // (e.g. 3), so the bar MUST be allowed to decrease (showing "0/3",
            // not a stuck "0/35"). During a local run the live
            // statsReportLocalProgress events own the total instead (see
            // _localRunActive) to avoid flip-flopping against the lagging
            // server count.
            if (!this._localRunActive) {
                this._totalJobs = status.total_jobs || 0;
            }
            // Monotonic max: the local (Pyodide) per-scope progress events
            // (statsReportLocalProgress) run ahead of the backend, which only
            // sees a whole batch of 8 at a time. Taking max prevents the
            // batch-lagged backend count from yanking the bar backwards
            // (e.g. local at 6/10 then a poll reports backend 0 -> would
            // regress). On the server path the backend count is the only
            // source and increases monotonically anyway, so max is a no-op.
            this._completedJobs = Math.max(this._completedJobs || 0, status.completed_jobs || 0);
            if (this._completedJobs > prevCompleted) {
                this._lastProgressAt = Date.now();
            }

            // Update progress bar
            this._updateProgressBar();

            // Update results incrementally — but only fetch the heavy results
            // payload + rebuild the results DOM (which recreates every gear/item
            // <img>) when new scopes have actually completed, throttled to at
            // most once per RESULTS_RENDER_MIN_INTERVAL_MS, plus a forced final
            // render at completion. Previously this ran on every 3s tick for the
            // whole run, re-downloading the full (growing) results set and
            // reloading every icon — the "hundreds of MB" + "images reload every
            // 2s" the user saw. A completed count that went backwards means a
            // reset / new run was adopted, so refresh immediately. When the page
            // is closed we skip both the fetch and the render (the page-open
            // path reloads results on its own).
            const nowMs = Date.now();
            const lastRendered = this._lastRenderedCompleted || 0;
            const wentBackwards = this._completedJobs < lastRendered;
            const newWork = this._completedJobs > lastRendered;
            const throttleOk = (nowMs - (this._lastResultsRenderAt || 0)) >= RESULTS_RENDER_MIN_INTERVAL_MS;
            const shouldRefreshResults = this._isPageOpen &&
                (status.is_complete || wentBackwards || (newWork && throttleOk));
            if (shouldRefreshResults) {
                const resultsResp = await api.getStatsReportResults(uuid);
                // Re-check after await — polling may have been stopped meanwhile
                if (!this._pollInterval) return;
                if (resultsResp.success && resultsResp.results) {
                    this._results = resultsResp.results;
                    this._lastRenderedCompleted = this._completedJobs;
                    this._lastResultsRenderAt = nowMs;
                    this._renderResults();
                }
            }

            // Check for stall
            // 2026-05-22: temporarily hidden — the worker has known stall
            // triggers (heavy optimizer + long activities, dual-write
            // overhead). Surfacing this message confused users into thinking
            // the run had crashed when it was just slow. Re-enable once the
            // backend stall causes are fixed.
            if (this._isRunning && Date.now() - this._lastProgressAt > STALL_TIMEOUT_MS) {
                console.warn('[StatsReportPage] No progress in', STALL_TIMEOUT_MS, 'ms — possible stall (UI message suppressed)');
            }

            // Check completion
            if (status.is_complete) {
                this._isRunning = false;
                this._localRunActive = false;
                this._finishingSince = null;
                this._finishingRecoveryFired = false;
                this._stopPolling();
                this._hideProgressSection();

                if (status.is_failed) {
                    // Surface the failure to the user so they don't stare at a
                    // silent progress bar. Worker logs at /tmp/stats_report_worker_*.log.
                    this._updateNavIconState('idle');
                    api.showError('Goals report failed. Check server logs and try again.');
                    return;
                }

                if (this._isPageOpen) {
                    this._updateNavIconState('idle');
                    this._showRunSummary();
                    // Show stale banner if needed
                    if (status.is_stale && !this._staleDismissed &&
                        !localStorage.getItem(`stats_report_stale_dismissed_${this._runId}`)) {
                        this._$el.find('#stats-report-stale-banner').show();
                    }
                } else {
                    this._updateNavIconState('unread');
                }

                // 2026-06-02 (jwbail): refresh stale annotations now that
                // the worker has cleared its stale_scopes cache at
                // end-of-run. Without this dispatch, lingering (!)
                // badges from BEFORE the run hang around until the next
                // navigation event, even though the underlying data
                // says "nothing stale" once the run completes.
                try { window.dispatchEvent(new CustomEvent('stats-report-stale-refresh')); } catch (_) {}

                // Always show in-app toast
                api.showSuccess('Goals report complete — your optimization report is ready to view', {
                    onClick: () => { window.location.hash = '#goals-report'; }
                });
            }

        } catch (err) {
            this._pollFailures++;
            if (this._pollFailures >= MAX_POLL_FAILURES) {
                api.showInfo('Lost connection to optimization worker. Will retry when you return.');
                this._stopPolling();
            }
        }
    }

    // ========================================================================
    // PROGRESS UI
    // ========================================================================

    _fmtElapsed(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return m > 0 ? `${m}m${rem}s` : `${rem}s`;
    }

    _showRunSummary() {
        try {
            const total = this._totalJobs || 0;
            const completed = this._completedJobs || 0;
            let elapsedMs = 0;
            if (this._startedAt) {
                const start = new Date(this._startedAt).getTime();
                if (!isNaN(start)) elapsedMs = Date.now() - start;
            }
            const txt = `${completed}/${total} optimizations ran in ${this._fmtElapsed(elapsedMs)}`;
            this._$el.find('#stats-report-run-summary').text(txt).show();
        } catch (_) { /* non-fatal */ }
    }

    _showProgressSection() {
        this._$el.find('#stats-report-progress').show();
        this._updateProgressBar();
    }

    _hideProgressSection() {
        this._$el.find('#stats-report-progress').hide();
    }

    _updateProgressBar() {
        const total = this._totalJobs || 0;
        const completed = this._completedJobs || 0;
        // 2026-05-21: was `total = this._totalJobs || 1` which made the
        // label show "0/1" while the worker was still starting up
        // (total_jobs=0 in DB during that 200-300ms window before the
        // worker writes the real count). With total=0 below we now show
        // a "Starting…" placeholder. Once total > 0 we show the real
        // counter, and once we hit completed >= total we show a
        // "Finishing…" placeholder so the user never sees "10/10" right
        // before the progress section hides on completion.
        const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

        this._$el.find('#stats-report-progress-fill').css('width', `${pct}%`);
        const $label = this._$el.find('#stats-report-progress-label');
        if (total === 0) {
            $label.text('Starting…');
            this._finishingSince = null;
            this._finishingRecoveryFired = false;
        } else if (completed >= total) {
            $label.text('Finishing…');
            // 2026-06-16 (jwbail): watchdog — "Finishing…" means completed>=total
            // but the run hasn't transitioned to complete in the UI yet. If the
            // page is open and we think we're running but no poll is active
            // (e.g. after a local-run interruption / finish-on-server handoff
            // where polling stopped), start polling so the latest run's
            // completion (or supersession) clears this stuck state.
            if (this._isPageOpen && this._isRunning && !this._pollInterval) {
                try { this._startPolling(); } catch (_) {}
            }
            // 2026-06-30 (jwbail): one-shot recovery for a "Finishing…" that
            // sticks. The label can hang indefinitely when a local (Pyodide)
            // run finished computing all scopes client-side but the server run
            // row never flipped to complete (dropped /local-complete AND a lost
            // final /local-scope POST). After FINISHING_WATCHDOG_MS of
            // contiguous "Finishing…", re-fire the finalize + force a poll; if
            // still stuck, offer an escape hatch. Bug report def8e0d5.
            if (this._isPageOpen && this._isRunning && this._runId
                    && !this._finishingRecoveryFired) {
                if (this._finishingSince == null) {
                    this._finishingSince = Date.now();
                } else if (Date.now() - this._finishingSince >= FINISHING_WATCHDOG_MS) {
                    this._finishingRecoveryFired = true;
                    try { this._recoverStuckFinishing(); } catch (_) {}
                }
            }
        } else {
            $label.text(`${completed} / ${total} complete`);
            this._finishingSince = null;
            this._finishingRecoveryFired = false;
        }
        this._updateElapsedDisplay();
    }

    _updateElapsedDisplay() {
        if (!this._startedAt) return;
        const elapsed = Math.floor((Date.now() - new Date(this._startedAt).getTime()) / 1000);
        const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
        this._$el.find('#stats-report-elapsed').text(`${elapsedStr} elapsed`);

        // ETA: only show after first job completes
        const completed = this._completedJobs || 0;
        const total = this._totalJobs || 0;
        if (completed > 0 && total > completed) {
            const avgPerJob = elapsed / completed;
            const remaining = total - completed;
            const etaSecs = Math.round(avgPerJob * remaining);
            const etaStr = etaSecs < 60 ? `~${etaSecs}s remaining` : `~${Math.floor(etaSecs / 60)}m ${etaSecs % 60}s remaining`;
            this._$el.find('#stats-report-eta').text(etaStr);
        } else {
            this._$el.find('#stats-report-eta').text('');
        }
    }

    // ========================================================================
    // "FINISHING…" WATCHDOG RECOVERY (bug report def8e0d5)
    // ========================================================================

    /**
     * One-shot recovery when the progress bar has been stuck on "Finishing…"
     * for FINISHING_WATCHDOG_MS. Fired from _updateProgressBar.
     *
     * Order of attempts:
     *   1. Re-fire /local-complete (idempotent server-side — only completes a
     *      run still in status 'running'). Covers the common case where the
     *      browser's end-of-run finalize POST was dropped but every scope did
     *      land, so the run is "done but not flipped".
     *   2. Ensure polling is alive and force an immediate /status poll. If the
     *      re-finalize (or the server-side lazy-finalize safety net) flipped the
     *      run to complete, _pollProgress's completion path renders results and
     *      clears the stuck UI.
     *   3. If it STILL hasn't completed (e.g. the server lost the final scope
     *      POSTs so completed_jobs<total and no finalize path applies), surface
     *      an escape-hatch toast to load whatever results landed.
     */
    async _recoverStuckFinishing() {
        const runId = this._runId;
        if (!runId) return;
        console.warn('[StatsReportPage] "Finishing…" stuck > watchdog threshold — '
            + 'attempting recovery for run', runId);
        try {
            await api.forceFinalizeStatsReport(runId);
        } catch (_) { /* non-fatal — fall through to a forced poll */ }
        if (!this._pollInterval && this._isPageOpen && this._isRunning) {
            try { this._startPolling(); } catch (_) {}
        }
        try { await this._pollProgress(); } catch (_) {}
        if (this._isRunning && this._isPageOpen) {
            api.showInfo(
                'Goals report is taking longer than expected to finalize. '
                + 'Tap to load the results that are ready.',
                { duration: 12000, onClick: () => { this._loadAvailableResultsAndClear(); } }
            );
        }
    }

    /**
     * Escape hatch: load whatever results were persisted for this session and
     * clear the stuck "running"/"Finishing…" UI back to an idle, usable state.
     * Invoked from the recovery toast in _recoverStuckFinishing.
     */
    async _loadAvailableResultsAndClear() {
        try {
            const uuid = store.state.session?.uuid;
            const resp = await api.getStatsReportResults(uuid);
            if (resp && resp.success && resp.results) {
                this._results = resp.results;
                this._renderResults();
            }
        } catch (e) {
            console.warn('[StatsReportPage] _loadAvailableResultsAndClear failed:', e);
        }
        this._isRunning = false;
        this._localRunActive = false;
        this._finishingSince = null;
        this._finishingRecoveryFired = false;
        this._stopPolling();
        this._hideProgressSection();
        this._updateNavIconState('idle');
    }

    // ========================================================================
    // RESULTS RENDERING
    // ========================================================================

    _renderResults() {
        const $body = this._$el.find('#stats-report-results-body');
        if (!$body.length) return;

        const hasResults = Object.values(this._results).some(arr => arr.length > 0);
        if (!hasResults) {
            // No results to render — clear the previously-rendered body and
            // hide the wrapper so the user sees an empty UI after Reset.
            // Without this, an early `return` here left the prior run's
            // sections (Best XP, Best Coins, etc.) visible below the Reset
            // button even though the in-memory `this._results` was wiped.
            $body.empty();
            this._$el.find('#stats-report-results').hide();
            return;
        }

        this._$el.find('#stats-report-results').show();

        const html = CATEGORIES
            .map(cat => {
                const rows = this._results[cat.key];
                if (!rows || rows.length === 0) return '';
                return this._renderSection(cat, rows);
            })
            .join('');
        $body.html(html);

        // Wire (i) info icons (Secondary popover etc.). wireInfoIcons() is
        // idempotent — skips icons already wired — so calling it on every
        // re-render is safe.
        try { wireInfoIcons($body[0]); } catch (e) { console.warn('[StatsReportPage] wireInfoIcons failed:', e); }

        // 2026-05-24: wire the new_items item-name + item-icon as drop
        // popover anchors. Mirrors the column-3 drops list — hover/click
        // on the item shows the full stats + Wiki / Sources buttons.
        // wireDropAnchor is idempotent (early-returns when dataset.dropWired
        // is set), so calling it on every re-render is safe.
        try {
            const anchors = $body[0].querySelectorAll('.stats-report-drop-anchor');
            anchors.forEach(a => {
                const name = a.dataset.dropName;
                const ref = a.dataset.dropRef || '';
                if (!name) return;
                const isContainer = ref.startsWith('Container.');
                wireDropAnchor(a, name, isContainer);
            });
        } catch (e) {
            console.warn('[StatsReportPage] wireDropAnchor failed:', e);
        }

        // 2026-06-05 (jwbail): re-expand gear previews the user had open
        // before this re-render / leave-and-return. Section/category/skill
        // collapse already persists via _collapseState; gear previews now
        // do too (gear:<resultId>). Done after the body HTML is rebuilt so
        // the toggle buttons + containers exist.
        this._restoreExpandedGearPreviews();
    }

    /**
     * Re-open gear previews whose gear:<resultId> state is persisted as
     * expanded. Called after _renderResults rebuilds the body. Expands
     * instantly (no slide) to avoid a cascade of animations on restore.
     */
    _restoreExpandedGearPreviews() {
        try {
            const $btns = this._$el.find('.stats-report-gear-toggle-btn');
            $btns.each((_i, el) => {
                const $btn = $(el);
                const resultId = $btn.data('result-id');
                if (resultId == null) return;
                if ($btn.attr('data-expanded') === '1') return; // already open
                if (this._isExpanded(`gear:${resultId}`)) {
                    this._toggleGearPreview(resultId, $btn, true);
                }
            });
        } catch (_) { /* non-fatal */ }
    }

    /**
     * Top-level section (e.g. "Best XP/Leveling Activity per Skill").
     * Header is collapsible; body groups rows by Gathering/Artisan/Utility
     * → individual skill (or by chest name for chests/chests_recipes).
     */
    _renderSection(cat, rows) {
        const sectionKey = `section:${cat.key}`;
        const expanded = this._isExpanded(sectionKey);
        let groupingMode = 'skill';
        if (cat.key === 'chests' || cat.key === 'chests_recipes') groupingMode = 'chest';
        else if (cat.key === 'new_items') groupingMode = 'kind';

        return `
            <div class="stats-report-section ${expanded ? 'open' : ''}" data-section="${cat.key}">
                <div class="stats-report-section-header" data-section="${cat.key}">
                    <span class="stats-report-arrow">▼</span>
                    <h3 style="margin:0;flex:1;text-align:left">${cat.label}</h3>
                    <span class="stats-report-section-meta" style="color:var(--text-muted);font-size:0.85em">${rows.length} results</span>
                    <button class="button button-secondary stats-report-section-reset-btn"
                        data-category="${cat.key}"
                        title="Reset only this category's saved results so it recomputes fresh on the next run. Other categories and your character/gear data are untouched."
                        style="margin:0 0 0 10px;padding:2px 9px;font-size:0.78em;line-height:1.4">Reset</button>
                </div>
                <div class="stats-report-section-body" style="${expanded ? '' : 'display:none'}">
                    ${groupingMode === 'skill'
                        ? this._renderSectionGroupedBySkill(cat.key, rows)
                        : groupingMode === 'kind'
                            ? this._renderSectionGroupedByKind(cat.key, rows)
                            : this._renderSectionGroupedByChest(cat.key, rows)}
                </div>
            </div>
        `;
    }

    /**
     * Render new_items section grouped by kind (gear / tools / eggs / collectibles).
     * Worker overloads skill_name with the kind label, so we group on that field.
     * Empty subcategories show an "All accessible X obtained. Congrats!" message.
     */
    _renderSectionGroupedByKind(sectionKey, rows) {
        // 2026-05-22: source labels/colors/icons from the global KIND_META
        // (also used by the WTO chip list) so the WTO chip and the result
        // section header for a given kind look identical.
        const KINDS = ALL_KINDS;

        // Bucket rows by kind (skill_name carries the kind for new_items)
        const buckets = {};
        for (const r of rows) {
            const k = (r.skill_name || '').toLowerCase();
            if (!buckets[k]) buckets[k] = [];
            buckets[k].push(r);
        }

        // 2026-05-24 fix (jwbail): the prior implementation invented its
        // own DOM classes (.stats-report-cat-group + .stats-report-show-more-body
        // + data-kind-group) that none of the existing click handlers
        // recognized — so expand/collapse and "show more" silently no-op'd
        // for the new_items section while working everywhere else. The
        // user pointed out it should be using the same code as skill
        // groups. Now we mirror _renderSkillGroup exactly: same
        // .stats-report-skill-group / .stats-report-skill-header /
        // .stats-report-skill-body / .stats-report-skill-extras classes,
        // same data-skill-group attribute (carrying the kind label),
        // same data-target="skill-group" on the side bar. Result: the
        // existing cat-header / skill-header / show-more-btn click
        // handlers all fire correctly.
        let html = '';
        for (const kind of KINDS) {
            const kindRows = buckets[kind] || [];
            const meta = KIND_META[kind];
            const color = meta.color;
            const label = meta.label;
            const iconHtml = meta.icon
                ? `<img src="${meta.icon}" alt="${label}" width="32" height="32" onerror="this.style.display='none'">`
                : '';

            if (kindRows.length === 0) {
                // Empty kind group. Two very different reasons land here and
                // the worker can't tell them apart in the data: per spec
                // R5.13 it writes ZERO rows for a kind when every droppable
                // item is owned — and it also writes zero rows for a kind it
                // never ran. So an "all owned" kind and a "not optimized"
                // kind both arrive here with an empty bucket.
                //   (a) kind WAS in the optimize scope and all items owned
                //       -> "All owned. Congrats!"
                //   (b) kind was NOT in scope (user deselected it in the WTO
                //       sub-filter) -> we never optimized it, so claiming
                //       "All owned" is wrong. Show "Not optimized" instead.
                // _selectedKinds (default = all kinds) is the only signal
                // that separates these cases. User-reported: deselecting
                // tools still showed "All owned. Congrats!".
                this._hydrateSelectedKinds();
                const wasOptimized = this._selectedKinds.has(kind);
                const emptyMsg = wasOptimized
                    ? `All accessible ${label.toLowerCase()} obtained. Congrats!`
                    : 'Not optimized';
                // Congrats empty-state per spec R14 — keep this in the
                // skill-group shell so the section is uniform but skip
                // the body content (no expand needed for an empty group).
                html += `
                    <div class="stats-report-skill-group"
                         data-section="${sectionKey}" data-skill-group="${kind}"
                         style="--chip-color:${color};--glow-color:${color}">
                        <div class="stats-report-skill-header" data-section="${sectionKey}" data-skill-group="${kind}" style="cursor:default">
                            ${iconHtml}
                            <span style="flex:1;text-align:left;font-weight:600">${label}</span>
                            <span class="stats-report-group-meta" style="color:#9c9;font-style:italic">${emptyMsg}</span>
                        </div>
                    </div>
                `;
                continue;
            }

            // Sort ascending by metric (lower steps = better). The kind
            // bucket key is the kind label itself so it survives across
            // re-renders without colliding with skill-group keys (skills
            // come pre-cased like 'Mining', kinds come lowercased here).
            kindRows.sort((a, b) =>
                Number(a.metric_value || Infinity) - Number(b.metric_value || Infinity)
            );
            const top = kindRows[0];
            const rest = kindRows.slice(1);
            const total = kindRows.length;

            const skillKey = `skill:${sectionKey}:${kind}`;
            const expanded = this._isExpanded(skillKey);
            const showMoreKey = `${sectionKey}::${kind}`;
            const showMore = this._showMoreExpanded.has(showMoreKey);

            const topMetric = top && top.metric_value != null
                ? Math.ceil(Number(top.metric_value)).toLocaleString() : '—';

            html += `
                <div class="stats-report-skill-group ${expanded ? 'open' : ''}"
                     data-section="${sectionKey}" data-skill-group="${kind}"
                     style="--chip-color:${color};--glow-color:${color}">
                    <div class="stats-report-side-collapse" data-target="skill-group" title="Collapse / expand"></div>
                    <div class="stats-report-skill-header" data-section="${sectionKey}" data-skill-group="${kind}">
                        <span class="stats-report-arrow">▼</span>
                        ${iconHtml}
                        <span style="flex:1;text-align:left;font-weight:600">${label}</span>
                        <span class="stats-report-group-meta">Top ${topMetric} · ${total} activities</span>
                    </div>
                    <div class="stats-report-skill-body" style="${expanded ? '' : 'display:none'}">
                        ${this._renderResultRow(top, 0, total, sectionKey, color)}
                        ${rest.length > 0 ? `
                            <div class="stats-report-show-more-wrap">
                                <button class="button button-secondary stats-report-show-more-btn ${showMore ? 'open' : ''}"
                                    data-section="${sectionKey}" data-skill-group="${kind}">
                                    <span class="stats-report-show-more-arrow">▼</span>
                                    <span class="stats-report-show-more-label">${showMore ? 'Show less' : `Show ${rest.length} more`}</span>
                                </button>
                            </div>
                            <div class="stats-report-skill-extras" data-section="${sectionKey}" data-skill-group="${kind}" style="${showMore ? '' : 'display:none'}">
                                ${rest.map((r, i) => this._renderResultRow(r, i + 1, total, sectionKey, color)).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        return html;
    }

    /**
     * Original skill-grouped renderer — unchanged.
     */
    _renderSectionGroupedBySkill(sectionKey, rows) {
        // Bucket rows by category → skill
        const buckets = { Gathering: {}, Artisan: {}, Utility: {} };
        for (const r of rows) {
            const skill = r.skill_name || 'Other';
            const cat = SKILL_TO_CATEGORY[skill] || 'Utility';
            if (!buckets[cat]) buckets[cat] = {};
            if (!buckets[cat][skill]) buckets[cat][skill] = [];
            buckets[cat][skill].push(r);
        }

        let html = '';
        for (const catName of CATEGORY_ORDER) {
            const skillsInCat = buckets[catName];
            const skillNames = Object.keys(skillsInCat).sort();
            if (skillNames.length === 0) continue;

            const catKey = `category:${sectionKey}:${catName}`;
            const catExpanded = this._isExpanded(catKey);
            const totalRows = skillNames.reduce((acc, sn) => acc + skillsInCat[sn].length, 0);

            const catColor = CATEGORY_COLORS[catName] || 'var(--text-secondary)';
            html += `
                <div class="stats-report-cat-group ${catExpanded ? 'open' : ''}"
                     data-section="${sectionKey}" data-cat-group="${catName}"
                     style="--cat-color:${catColor};--glow-color:${catColor}">
                    <div class="stats-report-side-collapse" data-target="cat-group" title="Collapse / expand"></div>
                    <div class="stats-report-cat-header" data-section="${sectionKey}" data-cat-group="${catName}">
                        <span class="stats-report-arrow">▼</span>
                        <img src="${CATEGORY_ICONS[catName] || ''}" alt="${catName}" width="32" height="32" onerror="this.style.display='none'">
                        <h4 style="margin:0;flex:1;text-align:left">${catName}</h4>
                        <span class="stats-report-group-meta">${skillNames.length} skills · ${totalRows} results</span>
                    </div>
                    <div class="stats-report-cat-body" style="${catExpanded ? '' : 'display:none'}">
                        ${skillNames.map(sn => this._renderSkillGroup(sectionKey, sn, skillsInCat[sn])).join('')}
                    </div>
                </div>
            `;
        }
        return html;
    }

    /**
     * One skill subsection. Top-1 result is always visible when expanded;
     * the rest are hidden behind a "Show more ▾" button per user spec.
     */
    _renderSkillGroup(sectionKey, skillName, rowsForSkill) {
        const skillKey = `skill:${sectionKey}:${skillName}`;
        const expanded = this._isExpanded(skillKey);
        const showMoreKey = `${sectionKey}::${skillName}`;
        const showMore = this._showMoreExpanded.has(showMoreKey);

        const skillId = (skillName || '').toLowerCase();
        const skillIcon = SKILL_META[skillId]?.icon || `/assets/icons/text/skill_icons/${skillId}.svg`;
        const chipColor = SKILL_META[skillId]?.color || 'var(--text-secondary)';

        // Sort consistent with category ranking direction (descending for
        // xp/coins, ascending for chests/new_items). The rows arrive
        // pre-sorted by the backend in get_stats_report_results, but be
        // defensive here in case a partial poll surfaces them out of order.
        const top = rowsForSkill[0];
        const rest = rowsForSkill.slice(1);
        const total = rowsForSkill.length;
        const topMetric = top && top.metric_value != null
            ? formatFixed(Number(top.metric_value), 2) : '—';

        return `
            <div class="stats-report-skill-group ${expanded ? 'open' : ''}"
                 data-section="${sectionKey}" data-skill-group="${skillName}"
                 style="--chip-color:${chipColor};--glow-color:${chipColor}">
                <div class="stats-report-side-collapse" data-target="skill-group" title="Collapse / expand"></div>
                <div class="stats-report-skill-header" data-section="${sectionKey}" data-skill-group="${skillName}">
                    <span class="stats-report-arrow">▼</span>
                    <img src="${skillIcon}" alt="${skillName}" width="32" height="32" onerror="this.style.display='none'">
                    <span style="flex:1;text-align:left;font-weight:600">${skillName}</span>
                    <span class="stats-report-group-meta">Top ${topMetric} · ${total} results</span>
                </div>
                <div class="stats-report-skill-body" style="${expanded ? '' : 'display:none'}">
                    ${top ? this._renderResultRow(top, 0, total, sectionKey, chipColor) : ''}
                    ${rest.length > 0 ? `
                        <div class="stats-report-show-more-wrap">
                            <button class="button button-secondary stats-report-show-more-btn ${showMore ? 'open' : ''}"
                                data-section="${sectionKey}" data-skill-group="${skillName}">
                                <span class="stats-report-show-more-arrow">▼</span>
                                <span class="stats-report-show-more-label">${showMore ? 'Show less' : `Show ${rest.length} more`}</span>
                            </button>
                            </button>
                        </div>
                        <div class="stats-report-skill-extras" data-section="${sectionKey}" data-skill-group="${skillName}" style="${showMore ? '' : 'display:none'}">
                            ${rest.map((r, i) => this._renderResultRow(r, i + 1, total, sectionKey, chipColor)).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * For chests/chests_recipes: group rows by chest_name, top-1 per chest
     * always visible, rest behind "Show more ▾".
     */
    _renderSectionGroupedByChest(sectionKey, rows) {
        const buckets = {};
        for (const r of rows) {
            // Hide 0/invalid-metric rows ENTIRELY (not just sink them). A
            // stored metric of 0 is never a valid chest result (you can't
            // farm a chest in 0 steps) -- it's a stuck artifact from a
            // transient local-optimize OOM. Dropping it here means a chest
            // whose rows are ALL degenerate renders no empty group at all,
            // and the "N results" count reflects only real rows. The
            // degenerate scopes are separately flagged stale ("new activity")
            // via /stale-check and self-heal recomputed on the next run.
            const mv = Number(r.metric_value);
            if (!(mv > 0)) continue;
            const cn = r.chest_name || 'Unknown chest';
            if (!buckets[cn]) buckets[cn] = [];
            buckets[cn].push(r);
        }
        const chestNames = Object.keys(buckets).sort();
        if (chestNames.length === 0) return '';

        return chestNames.map(cn => {
            const rowsForChest = buckets[cn];
            // Sort fewest-steps-first, pushing 0/invalid metrics LAST. `0 ||
            // Infinity` -> Infinity because 0 is falsy, so a stray 0-metric row
            // (e.g. a recipe that OOMed during local optimization) can't sort
            // to the top and blank the chest. Mirrors the skill/kind groupers.
            // Bug: "best chest farming from recipes ... everything else shows
            // blank" -- carpentry had no 0s so it rendered; other chests had 0s
            // ranked first by the server's ORDER BY metric_value.
            rowsForChest.sort((a, b) =>
                Number(a.metric_value || Infinity) - Number(b.metric_value || Infinity)
            );
            const chestKey = `chest:${sectionKey}:${cn}`;
            const expanded = this._isExpanded(chestKey);
            const showMoreKey = `${sectionKey}::${cn}`;
            const showMore = this._showMoreExpanded.has(showMoreKey);

            const chestSlug = cn.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const chestIcon = `/assets/icons/items/containers/${chestSlug}.svg`;
            const chestColor = chestColorFor(cn);

            const top = rowsForChest[0];
            const rest = rowsForChest.slice(1);
            const total = rowsForChest.length;
            const topMetric = top && top.metric_value != null
                ? Math.ceil(Number(top.metric_value)).toLocaleString() : '—';

            return `
                <div class="stats-report-skill-group ${expanded ? 'open' : ''}"
                     data-section="${sectionKey}" data-chest-group="${cn}"
                     style="--chip-color:${chestColor};--glow-color:${chestColor}">
                    <div class="stats-report-side-collapse" data-target="skill-group" title="Collapse / expand"></div>
                    <div class="stats-report-skill-header" data-section="${sectionKey}" data-chest-group="${cn}">
                        <span class="stats-report-arrow">▼</span>
                        <img src="${chestIcon}" alt="${cn}" width="32" height="32" onerror="this.style.display='none'">
                        <span style="flex:1;text-align:left;font-weight:600">${cn}</span>
                        <span class="stats-report-group-meta">Top ${topMetric} · ${total} results</span>
                    </div>
                    <div class="stats-report-skill-body" style="${expanded ? '' : 'display:none'}">
                        ${top ? this._renderResultRow(top, 0, total, sectionKey, chestColor) : ''}
                        ${rest.length > 0 ? `
                            <div class="stats-report-show-more-wrap">
                                <button class="button button-secondary stats-report-show-more-btn ${showMore ? 'open' : ''}"
                                    data-section="${sectionKey}" data-chest-group="${cn}">
                                    <span class="stats-report-show-more-arrow">▼</span>
                                    <span class="stats-report-show-more-label">${showMore ? 'Show less' : `Show ${rest.length} more`}</span>
                                </button>
                            </div>
                            <div class="stats-report-skill-extras" data-section="${sectionKey}" data-chest-group="${cn}" style="${showMore ? '' : 'display:none'}">
                                ${rest.map((r, i) => this._renderResultRow(r, i + 1, total, sectionKey, chestColor)).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    _renderResultRow(row, idx, total, category, rowColor) {
        const color = this._metricColor(idx, total, category);
        const metricLabel = CATEGORY_METRIC_LABELS[category] || 'Metric';
        const activityName = row.activity_name || row.skill_name || '—';
        const isSaved = row._saved;
        const hasGearset = !!row.gearset_export;

        // Podium box for the top three rows. Per user direction, the
        // gold/silver/bronze color goes ONLY on a small rounded box
        // behind the rank number — not on the whole row's background.
        // All rank glyph text stays white; only the box background
        // changes for #1/#2/#3.
        const rankBoxClass = idx === 0 ? 'stats-report-rank-box-gold'
            : idx === 1 ? 'stats-report-rank-box-silver'
            : idx === 2 ? 'stats-report-rank-box-bronze'
            : '';

        // Per-row left border tinted to the parent group's color (skill or
        // chest). Mirrors the crafting tree's tree-node-card pattern —
        // `border-left: 6px solid var(--row-color)` + a hover box-shadow
        // glow defined in CSS, with --row-color set inline so the same
        // CSS rule colors every variant.
        const rowColorVar = rowColor || 'var(--text-secondary)';

        // Parse the metrics_breakdown blob the worker now writes. Older
        // rows (pre-migration) have NULL → we fall back gracefully.
        let metricsBreakdown = null;
        if (row.metrics_json) {
            try {
                metricsBreakdown = typeof row.metrics_json === 'string'
                    ? JSON.parse(row.metrics_json) : row.metrics_json;
            } catch (_) { metricsBreakdown = null; }
        }

        // 2026-05-21: if the user has manually edited this row's slots
        // via the in-place picker, prefer the altered value + breakdown
        // over the worker's. _alteredRows survives polls/re-renders
        // until the user reruns Optimize All. The asterisk indicator
        // below also keys off this map.
        const alteredEntry = this._alteredRows.get(String(row.id));
        if (alteredEntry && alteredEntry.metricValue != null) {
            // metricsJson may be missing on a stale entry — fall back
            // to the worker's blob in that case.
            if (alteredEntry.metricsJson) metricsBreakdown = alteredEntry.metricsJson;
        }

        // For XP rows, prefer the section-skill XP/step from the metrics
        // breakdown. The worker (commit 89e91d09) writes `metric_value`
        // already keyed to the section skill, but if a row was produced
        // by an older worker — or if `metric_value` somehow ended up
        // primary-keyed — `xp_per_step_by_skill[section_skill]` is the
        // authoritative number. This makes Gold panning correctly read
        // 0.518 (Fishing XP/step) under the Fishing section instead of
        // 0.83 (Mining XP/step) without requiring a fresh run on every
        // existing report.
        let metricValueNum = row.metric_value != null ? Number(row.metric_value) : null;
        if (alteredEntry && alteredEntry.metricValue != null) {
            metricValueNum = Number(alteredEntry.metricValue);
        }
        if (category === 'xp' && metricsBreakdown && row.skill_name) {
            const xpByskill = metricsBreakdown.xp_per_step_by_skill || {};
            const expSteps = Number(metricsBreakdown.expected_steps_per_action) || 0;
            // Try the per-skill map first (new metrics format).
            if (xpByskill[row.skill_name] != null) {
                metricValueNum = Number(xpByskill[row.skill_name]);
            } else {
                // Fallback for older runs: derive from secondary_xp_per_action
                // ÷ expected_steps_per_action when the section skill is a
                // secondary. For the primary skill the existing
                // metric_value already matches.
                const secByskill = metricsBreakdown.secondary_xp_per_action || {};
                if (expSteps > 0 && secByskill[row.skill_name] != null) {
                    metricValueNum = Number(secByskill[row.skill_name]) / expSteps;
                }
            }
        }
        const metricVal = metricValueNum != null
            ? (category === 'new_items' || category === 'chests' || category === 'chests_recipes'
                ? Math.ceil(metricValueNum).toLocaleString()
                : formatFixed(metricValueNum, 2))
            : '—';

        // For new_items: the item name (from metric_name) is now rendered
        // as the row title in the new layout below — see the new_items
        // branch in the top-row block. The old subLabel ("Steps/new gear
        // (Birch skis)") was removed because it duplicated the metric
        // unit that the section banner already shows.
        const subLabel = '';

        // 2026-05-24: derive the item icon path for new_items rows from
        // metrics_breakdown.best_drop. Uses the canonical resolveItemIcon
        // helper (./utils/resolve-item-icon.js) so apostrophes/hyphens in
        // the item name (e.g. "Lost Timmy's sand shovel") survive into
        // the filename, AND eggs hit the correct `/pet_eggs/` folder
        // (NOT `/eggs/`). Bug fix per jwbail 2026-05-25 — previous
        // inline derivation produced wrong paths for both cases.
        let newItemIconPath = '';
        let newItemName = '';
        let newItemRef = '';
        if (category === 'new_items') {
            const bd = (metricsBreakdown && metricsBreakdown.best_drop) || null;
            if (bd && bd.item_ref) {
                newItemRef = bd.item_ref;
                newItemName = bd.item_name || row.metric_name || '';
                newItemIconPath = resolveItemIcon({
                    itemRef: newItemRef,
                    itemName: newItemName,
                });
            } else if (row.metric_name) {
                // Fallback: older rows from before the best_drop CR
                // have just the item name in metric_name. We have no
                // ref to know the kind, so leave the icon empty and
                // let the row render with name only.
                newItemName = row.metric_name;
            }
        }

        // Total XP/step + per-skill breakdown popover.
        // 2026-05-20 polish (per user direction):
        //   - The metric pill itself now shows just "<value> XP/step"
        //     without a leading skill name (the section already says
        //     which skill it is — e.g. inside Fishing).
        //   - For activities that grant XP to more than one skill, a
        //     "Total: X XP/step ⓘ" line renders below the pill. The
        //     ⓘ icon opens a popover with the full per-skill breakdown
        //     (Skill / Per step / Per action). Single-skill activities
        //     get no Total line — there's nothing to add.
        let totalXpHtml = '';
        if (category === 'xp' && metricsBreakdown) {
            const xpByskill = metricsBreakdown.xp_per_step_by_skill || {};
            const skillEntries = Object.entries(xpByskill)
                .filter(([, v]) => Number(v) > 0)
                .sort(([, a], [, b]) => Number(b) - Number(a));
            const sectionSkill = row.skill_name; // the skill grouping this row sits under
            const primarySkill = metricsBreakdown.primary_skill;
            const totalXp = Number(metricsBreakdown.total_xp_per_step)
                || skillEntries.reduce((acc, [, v]) => acc + Number(v), 0);

            if (skillEntries.length > 1) {
                // 2026-06-02 (jwbail): popover format pass —
                //   - drop "/step" and "/action" suffix on each value
                //     cell (header already says "Per step" / "Per action")
                //   - drop the "(primary)" tag — primary skill is just
                //     listed first
                //   - keep the section-skill row highlighted so the
                //     user knows which one they're viewing under
                //   - 2-decimal rounding on per-action so two rows that
                //     differ by <0.1 (e.g. Mining 873.09 vs Foraging
                //     873.09) read consistently with the equip view
                //
                // Sort: primary first, then remaining by XP descending.
                const primaryEntry = skillEntries.find(([sk]) =>
                    primarySkill && sk.toLowerCase() === primarySkill.toLowerCase()
                );
                const otherEntries = skillEntries.filter(([sk]) =>
                    !primarySkill || sk.toLowerCase() !== primarySkill.toLowerCase()
                );
                const ordered = primaryEntry
                    ? [primaryEntry, ...otherEntries]
                    : skillEntries;
                const rowsHtml = ordered.map(([sk, perStep]) => {
                    const perAction = (Number(metricsBreakdown.expected_steps_per_action) || 0) * Number(perStep);
                    const isSection = sectionSkill && sk.toLowerCase() === sectionSkill.toLowerCase();
                    const skLabel = sk.charAt(0).toUpperCase() + sk.slice(1);
                    const skIcon = SKILL_META[sk.toLowerCase()]?.icon || '';
                    const iconHtml = skIcon
                        ? `<img src="${skIcon}" alt="" width="16" height="16" style="vertical-align:middle;margin-right:6px" onerror="this.style.display='none'" />`
                        : '';
                    const rowStyle = isSection ? 'background:rgba(74,144,226,0.18);font-weight:600' : '';
                    return `<tr style="${rowStyle}"><td style="padding:3px 10px 3px 6px">${iconHtml}${skLabel}</td>` +
                        `<td style="padding:3px 10px 3px 0;text-align:right">${formatFixed(perStep, 3)}</td>` +
                        `<td style="padding:3px 6px 3px 0;text-align:right;color:var(--text-muted)">${formatFixed(perAction, 2)}</td></tr>`;
                }).join('');
                const totalRow = `<tr style="border-top:1px solid var(--border-color)">` +
                    `<td style="padding:3px 10px 3px 6px;font-weight:600">Total</td>` +
                    `<td style="padding:3px 10px 3px 0;text-align:right;font-weight:600">${formatFixed(totalXp, 3)}</td>` +
                    `<td style="padding:3px 6px 3px 0"></td></tr>`;
                const popoverHtml = (
                    `<div style=\"font-size:0.9em\"><table style=\"border-collapse:collapse;width:100%\">` +
                    `<thead><tr><th style=\"text-align:left;padding:0 10px 6px 6px\">Skill</th>` +
                    `<th style=\"text-align:right;padding:0 10px 6px 0\">Per step</th>` +
                    `<th style=\"text-align:right;padding:0 6px 6px 0\">Per action</th></tr></thead>` +
                    `<tbody>${rowsHtml}${totalRow}</tbody></table></div>`
                ).replace(/"/g, '&quot;');
                totalXpHtml = `
                    <span class="stats-report-total-xp" style="display:inline-flex;align-items:center;gap:4px;font-size:0.85em;color:var(--text-primary)">
                        <strong>Total:</strong> ${formatFixed(totalXp, 2)} XP/step
                        <span class="travel-info-icon"
                              data-info-title="XP breakdown by skill"
                              data-info-html="${popoverHtml}"
                              style="color:var(--accent, #4a90e2);font-weight:600">ⓘ</span>
                    </span>
                `;
            }
        }
        // The standalone "+N more ⓘ" element is gone — the (ⓘ) now lives
        // on the Total line above. `secondaryHtml` is kept as an empty
        // string so the existing `${stepsToNextHtml}${secondaryHtml}`
        // composition below doesn't need to change shape.
        const secondaryHtml = '';

        // 2026-06-03 (jwbail): Total steps/all-chests line for chests
        // category rows (and chests_recipes when the recipe path emits
        // chests_per_chest). Mirrors the Total XP line — only renders
        // when the activity drops 2+ chest types (e.g. via
        // treasure_grabber gear adding Treasure chest drops on top of
        // the activity's native chest). Single-chest activities don't
        // have anything to aggregate, so the line stays hidden.
        // Aggregation is harmonic: 1 / Σ(1/spc) so a chest at 1500
        // steps + a chest at 3000 steps gives 1000 steps/any-chest.
        let totalChestsHtml = '';
        if ((category === 'chests' || category === 'chests_recipes') && metricsBreakdown) {
            const chestsByName = metricsBreakdown.chests_per_chest || {};
            const chestEntries = Object.entries(chestsByName)
                .filter(([, v]) => Number(v) > 0 && isFinite(Number(v)))
                .sort(([, a], [, b]) => Number(a) - Number(b)); // ascending — fewest steps first
            const totalAny = Number(metricsBreakdown.steps_per_any_chest);
            const sectionChest = row.chest_name || '';

            if (chestEntries.length > 1 && totalAny > 0 && isFinite(totalAny)) {
                const rowsHtml = chestEntries.map(([cn, spc]) => {
                    const isSection = sectionChest && cn === sectionChest;
                    const rowStyle = isSection ? 'background:rgba(74,144,226,0.18);font-weight:600' : '';
                    return `<tr style="${rowStyle}"><td style="padding:3px 10px 3px 6px">${cn}</td>` +
                        `<td style="padding:3px 6px 3px 0;text-align:right">${formatFixed(spc, 0, { trim: true })}</td></tr>`;
                }).join('');
                const totalRow = `<tr style="border-top:1px solid var(--border-color)">` +
                    `<td style="padding:3px 10px 3px 6px;font-weight:600">Total (any chest)</td>` +
                    `<td style="padding:3px 6px 3px 0;text-align:right;font-weight:600">${formatFixed(totalAny, 0, { trim: true })}</td></tr>`;
                const popoverHtml = (
                    `<div style=\"font-size:0.9em\"><table style=\"border-collapse:collapse;width:100%\">` +
                    `<thead><tr><th style=\"text-align:left;padding:0 10px 6px 6px\">Chest</th>` +
                    `<th style=\"text-align:right;padding:0 6px 6px 0\">Steps/chest</th></tr></thead>` +
                    `<tbody>${rowsHtml}${totalRow}</tbody></table></div>`
                ).replace(/"/g, '&quot;');
                totalChestsHtml = `
                    <span class="stats-report-total-chests" style="display:inline-flex;align-items:center;gap:4px;font-size:0.85em;color:var(--text-primary)">
                        <strong>Total:</strong> ${formatFixed(totalAny, 0, { trim: true })} steps/all chests
                        <span class="travel-info-icon"
                              data-info-title="Steps breakdown by chest type"
                              data-info-html="${popoverHtml}"
                              style="color:var(--accent, #4a90e2);font-weight:600">ⓘ</span>
                    </span>
                `;
            }
        }

        // Steps to next level — only meaningful for XP/Coins (where there's
        // an XP-earning context) and where the row carries a primary skill.
        let stepsToNextHtml = '';
        if (category === 'xp' && metricsBreakdown && row.skill_name) {
            const charSkills = window.store?.state?.character?.skills || {};
            const stn = stepsToNextLevel(row.skill_name, metricsBreakdown, charSkills);
            if (stn != null && stn > 0) {
                stepsToNextHtml = `
                    <span class="stats-report-steps-to-next" style="display:inline-flex;align-items:center;gap:4px;font-size:0.78em;color:var(--text-muted);margin-left:6px"
                          title="Total steps to your next ${row.skill_name} level (uses the displayed steps for one action as a floor and expected steps × actions otherwise — same arithmetic the in-game calculator uses).">
                        Next level: <strong style="color:var(--text-primary);font-weight:600">${formatFixed(stn, 0, { trim: true })}</strong> steps
                    </span>
                `;
            } else if (stn === 0) {
                stepsToNextHtml = `
                    <span class="stats-report-steps-to-next" style="display:inline-flex;align-items:center;gap:4px;font-size:0.78em;color:var(--text-muted);margin-left:6px"
                          title="Already at max level for ${row.skill_name}">
                        ★ Max level
                    </span>
                `;
            }
        }

        // Resolve activity icon + first location from the cached
        // /api/activities catalog. If the cache hasn't loaded yet (cold
        // page open), we fall back to generic placeholders and let the
        // catalog's resolve callback re-render once it arrives.
        const actRecord = this._activitiesByName ? this._activitiesByName.get(activityName) : null;
        const actIcon = actRecord && actRecord.icon_path
            ? actRecord.icon_path
            : (row.skill_name
                ? `/assets/icons/activities/${row.skill_name.toLowerCase()}/generic.svg`
                : '/assets/icons/attributes/work_efficiency.svg');
        const firstLoc = actRecord && Array.isArray(actRecord.locations) && actRecord.locations.length > 0
            ? actRecord.locations[0] : null;
        let locName = firstLoc ? (firstLoc.name || '') : '';
        let locIcon = firstLoc && firstLoc.icon_name
            ? `/assets/icons/locations/${firstLoc.icon_name}`
            : (firstLoc ? `/assets/icons/locations/${(firstLoc.id || firstLoc.name || '').toLowerCase().replace(/\s+/g, '_')}.svg` : '');

        // 2026-05-22: chests_recipes rows display the recipe's SERVICE
        // (e.g. "Basic Sawmill (Granfiddich)") in the location slot.
        // The worker writes service_id/service_name/service_location/
        // service_icon into metrics_json for each chests_recipes job.
        // Recipes don't have an activity-style location, so the service
        // is the equivalent display piece.
        let recipeIconPath = null;
        if (category === 'chests_recipes' && metricsBreakdown) {
            const svcName = metricsBreakdown.service_name || '';
            const svcLoc = metricsBreakdown.service_location || '';
            const svcIcon = metricsBreakdown.service_icon || '';
            if (svcName) {
                locName = svcLoc ? `${svcName} (${svcLoc})` : svcName;
                locIcon = svcIcon || '';
            } else if (svcLoc) {
                // 2026-06-02 (jwbail): serviceless recipes — the worker
                // ran a location iteration and picked the region with
                // the best gear bonuses for this recipe. Render it as
                // a plain location pill (no service prefix) so users
                // see a meaningful "where" instead of a blank slot.
                locName = svcLoc;
                // 2026-06-02 (jwbail v2): look up the actual icon_name
                // from the locations catalog before slugifying. Location
                // SVG filenames are type-themed (e.g. castle_white_icon.svg,
                // port_green_icon.svg) — they are NOT named after the
                // location. Slugifying the location name produced 404s
                // for /assets/icons/locations/azurazera.svg and
                // /assets/icons/locations/bilgemont_port.svg. Falls
                // back to slugify only if the name isn't in the catalog
                // (preserving prior behavior for any new location the
                // catalog hasn't been updated to include).
                const knownIconName = this._locationIconByName
                    ? this._locationIconByName.get(svcLoc)
                    : null;
                if (knownIconName) {
                    locIcon = `/assets/icons/locations/${knownIconName}`;
                } else {
                    const locSlug = svcLoc.toLowerCase().replace(/\s+/g, '_').replace(/'/g, '');
                    locIcon = `/assets/icons/locations/${locSlug}.svg`;
                }
            }
            // 2026-06-02 (jwbail): row's main icon is the recipe OUTPUT
            // (the thing being crafted) — birch plank for "Cut a birch
            // plank", basic hatchet for "Make a basic hatchet", trash
            // for "Upcycle trash". Falls back to the chest container
            // icon for legacy rows that don't carry recipe_output_ref.
            const outputRef = metricsBreakdown.recipe_output_ref || '';
            const outputName = metricsBreakdown.recipe_output_name || '';
            if (outputRef || outputName) {
                recipeIconPath = resolveItemIcon({
                    itemRef: outputRef,
                    itemName: outputName,
                });
            }
            if (!recipeIconPath && row.chest_name) {
                const chestSlug = row.chest_name.toLowerCase()
                    .replace(/\s+/g, '_').replace(/'/g, '');
                recipeIconPath = `/assets/icons/items/containers/${chestSlug}.svg`;
            }
        }
        const displayIcon = recipeIconPath || actIcon;

        return `
            <div class="stats-report-result-row">
                <!-- Floating rank circle in the top-left corner. Overhangs
                     the card by ~1/3 of its diameter on top and left so it
                     reads as a "floating badge" anchored to the corner.
                     For ranks 1-3 it carries the gold/silver/bronze glow
                     applied via .stats-report-rank-box-* classes. For 4+
                     it stays neutral (just the white border + flat bg). -->
                <span class="stats-report-rank stats-report-rank-floating ${rankBoxClass}">${idx + 1}</span>
                <!-- Top row layout differs for new_items rows (per user
                     direction 2026-05-24). All other categories keep the
                     activity-icon-left layout. New layout for new_items:
                       [item icon 50x50]  item name (title)
                                          activity name
                                          location
                     The item icon + name double as drop-popover anchors
                     (wired in attachEvents → wireDropAnchor). -->
                ${category === 'new_items' ? `
                <div class="stats-report-row-top stats-report-row-top-new-items"
                     style="display:flex;align-items:flex-start;gap:10px">
                    ${newItemIconPath ? `
                        <img src="${newItemIconPath}"
                             alt="${(newItemName || '').replace(/"/g, '&quot;')}"
                             width="50" height="50"
                             class="stats-report-new-item-icon stats-report-drop-anchor"
                             data-drop-name="${(newItemName || '').replace(/"/g, '&quot;')}"
                             data-drop-ref="${(newItemRef || '').replace(/"/g, '&quot;')}"
                             style="flex-shrink:0;cursor:pointer"
                             onerror="this.style.visibility='hidden'">
                    ` : ''}
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left">
                        <span class="stats-report-new-item-name"
                              style="font-weight:600;font-size:1.05em">
                            ${newItemName || '—'}
                        </span>
                        <span class="stats-report-activity-name" style="color:var(--text-secondary);font-size:0.9em">${activityName}</span>
                        ${locName ? `
                            <span class="stats-report-loc-row">
                                ${locIcon ? `<img src="${locIcon}" alt="" width="22" height="22" class="stats-report-loc-icon" onerror="this.style.display='none'">` : ''}
                                <span style="color:var(--text-muted);font-size:0.85em">${locName}</span>
                            </span>
                        ` : ''}
                        ${(metricsBreakdown && metricsBreakdown.missing_input && metricsBreakdown.missing_input.keyword_display) ? `
                            <span class="stats-report-missing-input-badge"
                                  title="You don't own a ${metricsBreakdown.missing_input.keyword_display}${metricsBreakdown.missing_input.min_level > 0 ? ` (Lv.${metricsBreakdown.missing_input.min_level}+)` : ''} — required to perform this activity. The displayed metric assumes you have one."
                                  style="display:inline-flex;align-items:center;gap:4px;color:#e8820c;font-size:0.85em;font-weight:600;margin-top:2px">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" style="flex-shrink:0">
                                    <path d="M12 2 L1 22 L23 22 Z" stroke="#e8820c" stroke-width="2" stroke-linejoin="round" fill="rgba(232,130,12,0.15)"/>
                                    <path d="M12 9 L12 14" stroke="#e8820c" stroke-width="2" stroke-linecap="round"/>
                                    <circle cx="12" cy="17.5" r="1.2" fill="#e8820c"/>
                                </svg>
                                Requires ${metricsBreakdown.missing_input.keyword_display}${metricsBreakdown.missing_input.min_level > 0 ? ` (Lv.${metricsBreakdown.missing_input.min_level}+)` : ''}
                            </span>
                        ` : ''}
                    </div>
                </div>
                ` : `
                <!-- Top row: activity icon + name (allowed to wrap, no ellipsis)
                     + location. Pulled left because the rank used to sit here
                     and now floats over the corner instead. -->
                <div class="stats-report-row-top" style="display:flex;align-items:flex-start;gap:10px">
                    <img src="${displayIcon}" alt="${activityName}" width="50" height="50" class="stats-report-activity-icon" style="flex-shrink:0" onerror="this.style.visibility='hidden'">
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left">
                        <span class="stats-report-activity-name">${activityName}${subLabel}</span>
                        ${locName ? `
                            <span class="stats-report-loc-row">
                                ${locIcon ? `<img src="${locIcon}" alt="" width="30" height="30" class="stats-report-loc-icon" onerror="this.style.display='none'">` : ''}
                                <span>${locName}</span>
                            </span>
                        ` : ''}
                        ${(metricsBreakdown && metricsBreakdown.missing_input && metricsBreakdown.missing_input.keyword_display) ? `
                            <span class="stats-report-missing-input-badge"
                                  title="You don't own a ${metricsBreakdown.missing_input.keyword_display}${metricsBreakdown.missing_input.min_level > 0 ? ` (Lv.${metricsBreakdown.missing_input.min_level}+)` : ''} — required to perform this activity. The displayed metric assumes you have one."
                                  style="display:inline-flex;align-items:center;gap:4px;color:#e8820c;font-size:0.85em;font-weight:600;margin-top:2px">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" style="flex-shrink:0">
                                    <path d="M12 2 L1 22 L23 22 Z" stroke="#e8820c" stroke-width="2" stroke-linejoin="round" fill="rgba(232,130,12,0.15)"/>
                                    <path d="M12 9 L12 14" stroke="#e8820c" stroke-width="2" stroke-linecap="round"/>
                                    <circle cx="12" cy="17.5" r="1.2" fill="#e8820c"/>
                                </svg>
                                Requires ${metricsBreakdown.missing_input.keyword_display}${metricsBreakdown.missing_input.min_level > 0 ? ` (Lv.${metricsBreakdown.missing_input.min_level}+)` : ''}
                            </span>
                        ` : ''}
                    </div>
                </div>
                `}
                <!-- Metric strip below the activity row. The pill itself
                     sits left-aligned (was right) per user direction;
                     trimmed horizontal padding to make it visually
                     compact. Total XP / Steps-to-next / Secondary popover
                     sit to the right of the pill on the same line.
                     The action buttons (Gear, Equip, Save, Rerun) also
                     ride on this same row now (2026-05-21) — pushed to
                     the right via margin-left:auto on the first button.
                     They wrap to a second line when the row gets too
                     narrow, but the wrap is per-button, not a hard
                     break — keeps the metric and buttons together
                     on wide cards. -->
                <!-- Pill + buttons row. Buttons sit immediately right
                     of the pill (left-aligned, no margin-left:auto)
                     per user direction 2026-05-21. -->
                <div class="stats-report-metric-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span class="stats-report-metric-value" style="background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-size:0.95em;text-align:center;font-weight:600">
                        ${metricVal} <span style="font-size:0.75em;opacity:0.8;font-weight:400">${metricLabel}</span>${alteredEntry && alteredEntry.metricValue != null ? `<sup class="stats-report-altered-asterisk travel-info-icon" data-info-title="Gearset altered" data-info-html="This row's gearset has been altered after optimization. The displayed value reflects your current selection, not the optimizer's pick. Other rows in this section keep their optimizer ranking." style="color:#fff;font-weight:700;font-size:0.85em;margin-left:2px">*</sup>` : ''}
                    </span>
                    ${hasGearset ? `
                        <button class="button button-secondary stats-report-gear-toggle-btn"
                            data-result-id="${row.id}"
                            data-expanded="0"
                            style="font-size:0.9em;padding:6px 12px"
                            title="Show optimized gear setup">
                            Gear <span class="stats-report-gear-toggle-arrow">▼</span>
                        </button>
                    ` : ''}
                    ${hasGearset ? `
                        <button class="button button-primary stats-report-equip-btn"
                            data-result-id="${row.id}"
                            data-category="${category}"
                            data-activity-name="${(activityName || '').replace(/"/g, '&quot;')}"
                            data-gearset-export="${row.gearset_export}"
                            data-optimized-pet="${metricsBreakdown && metricsBreakdown.optimized_pet ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_pet)) : ''}"
                            data-optimized-consumable="${metricsBreakdown && metricsBreakdown.optimized_consumable ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_consumable)) : ''}"
                            data-optimized-input="${metricsBreakdown && metricsBreakdown.optimized_input ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_input)) : ''}"
                            data-optimized-service-name="${metricsBreakdown && metricsBreakdown.service_name ? (metricsBreakdown.service_name).replace(/"/g, '&quot;') : ''}"
                            data-optimized-service-location="${metricsBreakdown && metricsBreakdown.service_location ? (metricsBreakdown.service_location).replace(/"/g, '&quot;') : ''}"
                            style="font-size:0.9em;padding:6px 14px"
                            title="Equip this gearset to column 2 and open the activity">
                            Equip
                        </button>
                    ` : ''}
                    ${hasGearset ? `
                        <button class="button button-secondary stats-report-save-btn"
                            data-result-id="${row.id}"
                            style="font-size:0.9em;padding:6px 12px;${isSaved ? 'opacity:0.5;cursor:default' : ''}"
                            ${isSaved ? 'disabled' : ''}>
                            ${isSaved ? '✓ Saved' : 'Save to Gear Sets'}
                        </button>
                    ` : ''}
                    ${(category === 'xp' || category === 'coins') && row.skill_name ? `
                        <button class="button button-secondary stats-report-run-skill-btn"
                            data-skill="${row.skill_name}" data-category="${category}"
                            style="font-size:0.9em;padding:6px 12px">
                            ↻ Rerun
                        </button>
                    ` : ''}
                    ${category === 'new_items' && newItemRef ? `
                        <button class="button button-secondary stats-report-hide-new-item-btn"
                            data-result-id="${row.id}"
                            data-item-ref="${(newItemRef || '').replace(/"/g, '&quot;')}"
                            data-item-name="${(newItemName || '').replace(/"/g, '&quot;')}"
                            style="font-size:0.9em;padding:6px 12px;margin-left:auto;display:inline-flex;align-items:center;gap:5px"
                            title="Hide this item from the optimizer (click twice to confirm)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0" aria-hidden="true">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                            <span class="stats-report-hide-label">Hide</span>
                        </button>
                    ` : ''}
                    ${SINGLE_COMPLETION_ACTIVITY_STAT[activityName] ? `
                        <button class="button button-secondary stats-report-already-done-btn"
                            data-result-id="${row.id}"
                            data-activity-name="${(activityName || '').replace(/"/g, '&quot;')}"
                            data-stat-id="${SINGLE_COMPLETION_ACTIVITY_STAT[activityName]}"
                            style="font-size:0.9em;padding:6px 12px;margin-left:auto;display:inline-flex;align-items:center;gap:5px"
                            title="Mark this one-time activity as already completed and remove it from the goals report (click twice to confirm)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="flex-shrink:0" aria-hidden="true">
                                <path d="M20 6 L9 17 L4 12"/>
                            </svg>
                            <span class="stats-report-already-done-label">Already done</span>
                        </button>
                    ` : ''}
                </div>
                <!-- Total XP/step + Steps-to-next + Secondary popover live
                     on their own row BELOW the pill+buttons (per user
                     direction 2026-05-21). totalXpHtml carries the
                     "Total: X XP/step ⓘ" line for multi-skill activities;
                     stepsToNextHtml shows "Next level: N steps".
                     2026-06-03 (jwbail): totalChestsHtml carries the
                     parallel "Total: X steps/all chests ⓘ" line for
                     chests / chests_recipes rows when the activity
                     drops 2+ chest types. -->
                ${(totalXpHtml || totalChestsHtml || stepsToNextHtml || secondaryHtml) ? `
                    <div class="stats-report-extra-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                        ${totalXpHtml || ''}
                        ${totalChestsHtml || ''}
                        ${stepsToNextHtml}${secondaryHtml}
                    </div>
                ` : ''}
                ${hasGearset ? `
                    <div class="stats-report-gear-preview-container"
                         data-result-id="${row.id}"
                         data-gearset-export="${row.gearset_export}"
                         data-optimized-pet="${metricsBreakdown && metricsBreakdown.optimized_pet ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_pet)) : ''}"
                         data-optimized-consumable="${metricsBreakdown && metricsBreakdown.optimized_consumable ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_consumable)) : ''}"
                         data-optimized-input="${metricsBreakdown && metricsBreakdown.optimized_input ? encodeURIComponent(JSON.stringify(metricsBreakdown.optimized_input)) : ''}"
                         style="display:none">
                        <!-- Lazily populated by _toggleGearPreview() on first expand. Spans the full card width — was margin-left:88px before the rank moved to a floating badge. -->
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Compute a green→yellow→red gradient color for a metric value.
     * idx=0 is best (green), idx=total-1 is worst (red).
     */
    _metricColor(idx, total, category) {
        if (total <= 1) return '#4caf50';
        // Normalize 0..1 where 0=best, 1=worst
        const t = idx / (total - 1);
        // HSL: green=120, yellow=60, red=0
        const hue = Math.round(120 * (1 - t));
        return `hsl(${hue}, 70%, 38%)`;
    }

    // ========================================================================
    // SAVE GEARSET
    // ========================================================================

    async _saveGearset(resultId, $btn) {
        if (!resultId) return;
        try {
            $btn.prop('disabled', true).text('Saving…');
            const result = await api.saveStatsReportGearset(null, resultId);
            // After the async API call, the DOM may have been re-rendered
            // (stale poll or _loadInitialStatus). Re-find the button by
            // data-result-id to update the CURRENT element in the DOM.
            const $currentBtn = this._$el.find(`.stats-report-save-btn[data-result-id="${resultId}"]`);
            const $target = $currentBtn.length ? $currentBtn : $btn;
            if (result.success) {
                $target.text('✓ Saved').css('opacity', '0.5').prop('disabled', true);
                api.showSuccess(`Saved as "${result.name}"`);
            } else {
                $target.prop('disabled', false).text('Save to Gear Sets');
                api.showError(result.error || 'Failed to save gearset');
            }
        } catch (err) {
            const $currentBtn = this._$el.find(`.stats-report-save-btn[data-result-id="${resultId}"]`);
            const $target = $currentBtn.length ? $currentBtn : $btn;
            $target.prop('disabled', false).text('Save to Gear Sets');
            api.showError('Failed to save gearset');
        }
    }

    // ========================================================================
    // IN-PLACE GEAR-SLOT PICKER (2026-05-21)
    // ========================================================================
    //
    // When a row's gear preview is expanded, each .tree-gear-mini-slot
    // tile is clickable. We open the same item-selection-popup the col-2
    // and crafting-tree paths use, scoped to this row's activity. On
    // select we LOCALLY update the row's slots, recalc the metric via
    // /api/stats-report/recalc-row, and add an asterisk to the metric
    // pill — without re-running the optimizer or reordering the row.
    //
    // ========================================================================

    /**
     * Find a row by its DB id across this._results buckets.
     * Returns { row, category } or null.
     */
    _findRow(resultId) {
        for (const cat of Object.keys(this._results || {})) {
            const arr = this._results[cat] || [];
            for (const r of arr) {
                if (String(r.id) === String(resultId)) {
                    return { row: r, category: cat };
                }
            }
        }
        return null;
    }

    /**
     * Resolve the "current" slots map for a row: prefer any local edits
     * the user made via the slot picker (this._alteredRows), otherwise
     * fall back to the optimizer's gearset_export decoded once.
     * Returns the slots dict {slot: {itemId, quality, is_fine, ...}} or
     * {} if decode fails / the row has no gearset.
     */
    _getCurrentSlots(resultId) {
        const altered = this._alteredRows.get(String(resultId));
        if (altered && altered.slots) return { ...altered.slots };
        // Decode from the row's gearset_export
        const found = this._findRow(resultId);
        if (!found) return {};
        const exportStr = found.row && found.row.gearset_export;
        if (!exportStr) return {};
        let slots = {};
        try {
            slots = decodeGearsetSlots(exportStr) || {};
        } catch (_) {
            return {};
        }
        // 2026-06-02 (jwbail): merge optimizer's chosen pet / consumable /
        // input items into the slots dict so the slot popup's "currently
        // equipped" lookup hits them. Without this, clicking the pet or
        // consumable tile in the gear preview opens a popup that says
        // "No item equipped" even though the gear preview shows the
        // optimizer's pick. Mirrors the effectiveOverlay merge in
        // components/tree-node-card.js _renderGearPreview.
        const row = found.row;
        let mb = null;
        try {
            mb = row.metrics_json
                ? (typeof row.metrics_json === 'string'
                    ? JSON.parse(row.metrics_json)
                    : row.metrics_json)
                : null;
        } catch (_) { mb = null; }
        if (mb) {
            const optPet = mb.optimized_pet;
            const optCons = mb.optimized_consumable;
            const optInput = mb.optimized_input;
            if (optPet && !slots.pet) {
                slots.pet = { ...optPet, type: 'pet' };
            }
            if (optCons && !slots.consumable) {
                slots.consumable = { ...optCons, type: 'consumable' };
            }
            if (optInput && !slots.input) {
                slots.input = { ...optInput, type: 'input' };
            }
        }
        return slots;
    }

    /**
     * 2026-06-04 (jwbail): re-anchor slot-alternative old/new values onto
     * the row's actual displayed metric.
     *
     * The /api/stats-report/slot-alternatives endpoint scores the current
     * gearset and each candidate swap, but in an environment that doesn't
     * perfectly match the worker that produced the row (no selected
     * location/service; can't always reproduce the optimizer's exact
     * pet/consumable pick). Its absolute old_value therefore never equals
     * the row's metric (e.g. a chests_recipes row shows 1,924 steps/chest
     * but the endpoint's old_value was 4,316). The RELATIVE improvement
     * (new/old in the scored metric) is sound, though — the user confirmed
     * the right items surface as upgrades.
     *
     * So we keep only the ratio and re-anchor it onto the row's true
     * metric_value, converting into the row's display units:
     *   - xp (XP/step, higher better; scored metric also higher better):
     *       newDisp = rowVal * (new/old)
     *   - chests / chests_recipes (Steps/chest, lower better; scored metric
     *       steps, lower better): newDisp = rowVal * (new/old)
     *   - coins (Coins/1k steps, higher better; scored metric steps/coin,
     *       LOWER better): inverse → newDisp = rowVal * (old/new)
     *
     * Mutates the alternatives map in place. old_value becomes exactly the
     * row's metric; new_value is the consistent projection; delta/delta_pct
     * are recomputed; primary_display is set to the row's metric name so
     * the popup labels it the same as the row.
     */
    /**
     * Worker-computed slot alternatives stored on the row
     * (metrics_json._slot_alternatives), produced in the optimizer's
     * exact environment so the baseline == the row metric and the
     * ranking matches the normal optimizer. Returns null when the row
     * has been edited (stored alts are then stale — caller falls back to
     * the on-demand endpoint) or when none are stored.
     */
    _storedRowAlternatives(resultId, row, category) {
        if (this._alteredRows && this._alteredRows.has(String(resultId))) return null;
        let mj = null;
        try {
            mj = row.metrics_json
                ? (typeof row.metrics_json === 'string' ? JSON.parse(row.metrics_json) : row.metrics_json)
                : null;
        } catch (_) { mj = null; }
        if (!mj) return null;
        const alts = mj._slot_alternatives;
        const locked = mj._slot_locked_alternatives;
        const hasAlts = alts && Object.keys(alts).length > 0;
        const hasLocked = locked && Object.keys(locked).length > 0;
        if (!hasAlts && !hasLocked) return null;
        // Clone before anchoring — _anchorAlternativesToRow mutates in
        // place and mj is the live (cached) row object.
        let a = {}, l = {};
        try { a = JSON.parse(JSON.stringify(alts || {})); } catch (_) { a = {}; }
        try { l = JSON.parse(JSON.stringify(locked || {})); } catch (_) { l = {}; }
        this._anchorAlternativesToRow(a, row, category);
        this._anchorAlternativesToRow(l, row, category);
        return { alternatives: a, lockedAlternatives: l };
    }

    /**
     * Resolve the scoring target item for a row's slot-alternatives.
     * new_items rows farm a specific drop; the worker scored them on
     * steps_per_reward_roll::<best_drop> (find_collectibles-aware for
     * collectibles). Parse it from metrics_json.best_drop.item_name,
     * falling back to metric_name (the worker sets metric_name =
     * best_drop_name for new_items). Returns null for categories that
     * use chest_name instead.
     */
    _rowTargetItem(row, category) {
        if (!row || category !== 'new_items') return null;
        try {
            const mj = typeof row.metrics_json === 'string'
                ? JSON.parse(row.metrics_json) : row.metrics_json;
            if (mj && mj.best_drop && mj.best_drop.item_name) return mj.best_drop.item_name;
        } catch (_) { /* fall through to metric_name */ }
        return row.metric_name || null;
    }

    _anchorAlternativesToRow(altsBySlot, row, category) {
        if (!altsBySlot || !row) return;
        const rowVal = Number(row.metric_value);
        if (!isFinite(rowVal) || rowVal <= 0) return;
        // coins is the only category whose display metric runs opposite to
        // the optimizer's scored metric (coins/1k vs steps/coin).
        const inverse = (category === 'coins');
        // Label the alt's old/new with the ROW's display-unit label
        // (CATEGORY_METRIC_LABELS — what the row pill shows), since the
        // values below are projected into the row's display units. The
        // worker's metric_name is the SCORED-axis name (e.g. coins are
        // scored on steps_per_reward_roll::cat:coins -> "Steps/Target
        // Item"), which doesn't match the displayed coins/1k value.
        // User-reported: coins popup said "Steps/Target Item" instead of
        // "Coins/1k steps". Fall back to metric_name only if the category
        // has no display label.
        const label = CATEGORY_METRIC_LABELS[category] || row.metric_name || null;
        for (const slot of Object.keys(altsBySlot)) {
            const list = altsBySlot[slot];
            if (!Array.isArray(list)) continue;
            for (const alt of list) {
                const o = Number(alt.old_value);
                const n = Number(alt.new_value);
                if (!isFinite(o) || !isFinite(n) || o === 0 || n === 0) {
                    // Can't derive a ratio — at least show the row value as
                    // the baseline so it doesn't contradict the row.
                    alt.old_value = Number(rowVal.toFixed(4));
                    if (label) alt.primary_display = label;
                    continue;
                }
                const factor = inverse ? (o / n) : (n / o);
                const newDisp = rowVal * factor;
                alt.old_value = Number(rowVal.toFixed(4));
                alt.new_value = Number(newDisp.toFixed(4));
                alt.delta = Number((newDisp - rowVal).toFixed(4));
                alt.delta_pct = rowVal !== 0
                    ? Number((((newDisp - rowVal) / Math.abs(rowVal)) * 100).toFixed(2))
                    : null;
                if (label) alt.primary_display = label;
            }
        }
    }

    /**
     * Open the item selection popup for the given (row, slot). On
     * select, store the modified slot in this._alteredRows[resultId],
     * call the recalc endpoint, update the metric pill in place, and
     * re-render just that row's tile so the new icon shows.
     */
    async _handleSlotClick(resultId, slot) {
        const found = this._findRow(resultId);
        if (!found || !found.row) return;
        const row = found.row;
        const category = found.category;
        // Catalog must be loaded for the popup to render item details.
        try {
            if (api && typeof api.getCatalog === 'function') await api.getCatalog();
        } catch (_) { /* non-fatal — popup will degrade gracefully */ }

        const equippedSlots = this._getCurrentSlots(resultId);
        // Skill the popup uses for stat-applicability filtering. For XP
        // rows, prefer the section's skill (so the user sees swaps that
        // boost THIS section's XP). For other rows, fall back to the
        // activity's primary skill via the catalog cache.
        let popupSkill = (row.skill_name || '').toLowerCase() || null;
        if (!popupSkill && this._activitiesByName) {
            const actRec = this._activitiesByName.get(row.activity_name);
            if (actRec && actRec.primary_skill) {
                popupSkill = String(actRec.primary_skill).toLowerCase();
            }
        }

        if (!window.itemSelectionPopup || typeof window.itemSelectionPopup.show !== 'function') {
            api.showError('Item selection popup not available');
            return;
        }

        // Fetch (or reuse) the row's slot-alternatives. Cache key is the
        // current gearset's slot fingerprint — once the user edits a
        // slot we invalidate so the next click recomputes against the
        // new baseline. On the first click the request is in-flight
        // while the popup opens; the `pendingAlternatives` promise lets
        // us swap in the data once it lands without re-rendering the
        // popup from scratch.
        const gearsetKey = JSON.stringify(equippedSlots);
        let alternativesEntry = this._alternativesCache.get(String(resultId));
        let needsFetch = !alternativesEntry || alternativesEntry.gearsetKey !== gearsetKey;
        if (needsFetch) {
            // 2026-06-05 (jwbail): prefer the worker-computed alternatives
            // stored on the row (metrics_json._slot_alternatives). They're
            // produced in the optimizer's exact environment, so their
            // baseline == the row metric and the ranking matches the
            // normal optimizer — no on-demand re-scoring (which couldn't
            // reproduce the worker env and surfaced false positives). Only
            // fall back to the endpoint when the user has EDITED a slot
            // (stored alts are then stale for the new gearset).
            const stored = this._storedRowAlternatives(resultId, row, category);
            if (stored) {
                alternativesEntry = {
                    alternatives: stored.alternatives,
                    lockedAlternatives: stored.lockedAlternatives,
                    gearsetKey,
                    pending: null,
                };
                this._alternativesCache.set(String(resultId), alternativesEntry);
            } else {
            const targetItem = this._rowTargetItem(row, category);
            alternativesEntry = {
                alternatives: {},
                lockedAlternatives: {},
                gearsetKey,
                pending: api.getStatsReportSlotAlternatives({
                    activity_name: row.activity_name,
                    skill_name: row.skill_name,
                    category,
                    chest_name: row.chest_name || null,
                    target_item: targetItem,
                    gearset_slots: equippedSlots,
                }),
            };
            this._alternativesCache.set(String(resultId), alternativesEntry);
            // Resolve in the background — when it lands, update the
            // popup's tree-node-context if it's still open on this slot.
            alternativesEntry.pending.then((resp) => {
                if (resp && resp.success) {
                    alternativesEntry.alternatives = resp.alternatives || {};
                    alternativesEntry.lockedAlternatives = resp.locked_alternatives || {};
                    // 2026-06-04 (jwbail): anchor the alt old/new values to
                    // the ROW's displayed metric. The endpoint scores the
                    // current gearset in a slightly different environment
                    // than the worker (no location/service, and it can't
                    // perfectly reproduce the optimizer's pet/consumable
                    // pick), so its absolute old_value never matched the
                    // row (e.g. chests_recipes row=1924 but endpoint
                    // old=4316). Rather than replicate the worker's full
                    // env, we trust only the endpoint's RELATIVE ratio
                    // (new/old in the scored metric) and re-anchor it onto
                    // the row's true metric_value, converting into the
                    // row's display units. This makes "old" exactly match
                    // the row and "new" a consistent projection.
                    this._anchorAlternativesToRow(alternativesEntry.alternatives, found.row, category);
                    this._anchorAlternativesToRow(alternativesEntry.lockedAlternatives, found.row, category);
                }
                alternativesEntry.pending = null;
                // Hot-swap into the live popup if it's still showing
                // this row's slot. The popup re-renders alternatives
                // from this._treeNodeContext on each _rerenderInPlace,
                // so mutating those refs + triggering a re-render is
                // enough.
                const popup = window.itemSelectionPopup;
                if (popup && popup.visible && popup._treeNodeContext
                    && popup._treeNodeContext.nodeId === `stats-report:${resultId}`) {
                    popup._treeNodeContext.alternatives = alternativesEntry.alternatives;
                    popup._treeNodeContext.lockedAlternatives = alternativesEntry.lockedAlternatives;
                    // Fetch resolved — drop the loading affordance so the
                    // section renders the list (or "No better alternatives").
                    popup._treeNodeContext.alternativesLoading = false;
                    // Auto-expand the "Non-owned / Locked Upgrades"
                    // section if any alternatives came back. Mirrors
                    // the column-2 path's gearsets.current subscription
                    // which sets _alternativesExpanded=true when alts
                    // first arrive — without this the user has to
                    // expand the section manually after every slot
                    // click. (User reported "doesn't populate" — turns
                    // out it does populate, just stays collapsed.)
                    const slotAlts = (alternativesEntry.alternatives || {})[slot] || [];
                    const slotLocked = (alternativesEntry.lockedAlternatives || {})[slot] || [];
                    if (slotAlts.length + slotLocked.length > 0) {
                        popup._alternativesExpanded = true;
                    }
                    if (typeof popup._rerenderInPlace === 'function') {
                        try { popup._rerenderInPlace(); } catch (_) { /* non-fatal */ }
                    }
                }
            }).catch((_e) => {
                alternativesEntry.pending = null;
                // Drop the loading affordance on failure so the section
                // doesn't spin forever — falls back to "No better
                // alternatives" / optimizer button.
                const popup = window.itemSelectionPopup;
                if (popup && popup.visible && popup._treeNodeContext
                    && popup._treeNodeContext.nodeId === `stats-report:${resultId}`) {
                    popup._treeNodeContext.alternativesLoading = false;
                    if (typeof popup._rerenderInPlace === 'function') {
                        try { popup._rerenderInPlace(); } catch (_) { /* non-fatal */ }
                    }
                }
            });
            }
        }

        // Open the popup. Passing a treeNodeContext makes the popup
        // render its 3 visibility toggles (Show non-owned / Show
        // hidden / Show N/A) inline — the col-2 path already has them
        // outside the popup so it skips them, but for stats report we
        // want them present like the crafting tree does. The
        // alternatives + lockedAlternatives may still be {} when this
        // first opens (the fetch above populates them async); the
        // pending-promise hot-swap fills them in shortly after.
        window.itemSelectionPopup.show(slot, {
            treeNodeContext: {
                nodeId: `stats-report:${resultId}`,
                equippedSlots,
                alternatives: alternativesEntry.alternatives,
                lockedAlternatives: alternativesEntry.lockedAlternatives,
                // 2026-06-05 (jwbail): true while the fetch is still in
                // flight so the popup shows a "Finding upgrades…" spinner
                // instead of prematurely rendering "No better alternatives".
                // Cleared in the pending.then/.catch handlers above before
                // the re-render.
                alternativesLoading: !!alternativesEntry.pending,
                lockedSlots: {},
                skill: popupSkill,
                sourceType: 'activity',
                location: null,
            },
            onSelect: async (payload) => {
                if (!payload) return;
                // The tree-node-context popup invokes onSelect with a few
                // shapes depending on user action:
                //   { type: 'pick', slot, slotItem, locked, ... } — user
                //       picked an item from the list (this is what we
                //       care about — apply it to the local slot).
                //   { type: 'lock', slot, itemId, locked, ... } — user
                //       toggled the slot lock affordance. We never want
                //       to lock from the stats report — silently ignore
                //       so the popup just closes.
                if (payload.type === 'lock') return;
                const item = payload.slotItem || payload;
                if (!item || (!item.itemId && !item.name)) return;
                await this._applySlotEdit(resultId, slot, item);
            },
            onUnequip: async () => {
                await this._applySlotEdit(resultId, slot, null);
            },
        });
    }

    /**
     * Apply a slot edit locally. Updates this._alteredRows[resultId]
     * with the new slot, calls the backend to recalc the metric,
     * updates the pill display + asterisk, and patches the tile icon.
     */
    async _applySlotEdit(resultId, slot, item) {
        const found = this._findRow(resultId);
        if (!found) return;
        const row = found.row;
        const category = found.category;

        // Build the modified slot map. item===null means "clear".
        const slots = this._getCurrentSlots(resultId);
        if (item) {
            slots[slot] = {
                itemId: item.itemId || item.id || null,
                quality: item.quality || null,
                is_fine: !!item.is_fine,
                name: item.name,
                icon_path: item.icon_path,
                rarity: item.rarity,
                // Pet level if the slot is 'pet'.
                level: item.level || undefined,
            };
        } else {
            delete slots[slot];
        }

        // Optimistically mark the row altered so the asterisk shows
        // even before the recalc returns. We'll fill in the actual
        // value once the API responds.
        const prev = this._alteredRows.get(String(resultId)) || {};
        this._alteredRows.set(String(resultId), {
            ...prev,
            slots,
        });
        // Invalidate the slot-alternatives cache for this row — the
        // baseline gearset has shifted, so the old alternatives list
        // is stale (it's keyed off the previous gearsetKey). Next slot
        // click will recompute against the new baseline.
        this._alternativesCache.delete(String(resultId));
        this._patchRowAfterEdit(resultId, slot, item);

        // Call the backend recalc.
        try {
            const resp = await api.recalcStatsReportRow({
                activity_name: row.activity_name,
                skill_name: row.skill_name,
                category,
                chest_name: row.chest_name || null,
                gearset_slots: slots,
            });
            if (!resp || !resp.success) {
                api.showError('Failed to recalculate metric. The icon was swapped, but the value still reflects the previous gearset.');
                return;
            }
            // Persist the recalc result in the altered map and re-render
            // just the metric pill + asterisk for this row.
            this._alteredRows.set(String(resultId), {
                slots,
                metricValue: Number(resp.metric_value),
                metricsJson: resp.metrics_json || null,
            });
            this._refreshRowMetricDisplay(resultId);
        } catch (_) {
            api.showError('Recalc failed — icon swapped but metric is stale');
        }
    }

    /**
     * Patch the gear-preview tile for the modified slot so the user
     * sees the new icon immediately. Also re-runs renderMiniGearPreview
     * for the whole tile so multi-piece visuals (set-piece highlights,
     * etc.) stay consistent.
     */
    _patchRowAfterEdit(resultId, slot, item) {
        const $container = this._$el.find(
            `.stats-report-gear-preview-container[data-result-id="${resultId}"]`
        );
        if (!$container.length) return;
        // Easiest: re-run renderMiniGearPreview with the merged slots.
        // Re-parse the input attr from the container so the input tile
        // survives slot edits — it isn't stored in this._results-derived
        // slot maps. Worker sets optimized_input once per row and it
        // doesn't change when the user picks a different gear item.
        const slots = this._getCurrentSlots(resultId);
        const previewInputs = this._parsePreviewInputs($container);
        try {
            $container.html(renderMiniGearPreview(slots, { inputs: previewInputs }));
            $container.data('rendered', '1');
        } catch (_) { /* leave the existing markup */ }
    }

    /**
     * Read the optimizer's chosen input item(s) off the gear preview
     * container's data-optimized-input attribute and enrich each with
     * icon_path/rarity from the catalog. Returns an array suitable for
     * passing to renderMiniGearPreview's options.inputs. Worker only
     * carries name/itemId/rarity/keywords — input items live under
     * /assets/icons/items/equipment/ which the catalog knows about, so
     * we look them up by name/id to fill in the icon_path.
     */
    _parsePreviewInputs($container) {
        const inputAttr = $container.attr('data-optimized-input') || '';
        if (!inputAttr) return [];
        try {
            const inp = JSON.parse(decodeURIComponent(inputAttr));
            if (!inp || !inp.name) return [];
            let iconPath = inp.icon_path || '';
            let rarity = inp.rarity || 'common';
            try {
                const catalog = window.api?._catalogCache;
                const catalogItems = (catalog && catalog.items) || [];
                const fullItem = catalogItems.find(it =>
                    it.id === inp.itemId
                    || it.uuid === inp.itemId
                    || (it.name && inp.name && it.name.toLowerCase() === inp.name.toLowerCase()));
                if (fullItem) {
                    if (!iconPath) iconPath = fullItem.icon_path || '';
                    if (rarity === 'common' && fullItem.rarity) rarity = fullItem.rarity;
                }
            } catch (_) { /* non-fatal */ }
            return [{ ...inp, icon_path: iconPath, rarity }];
        } catch (_) {
            return [];
        }
    }

    /**
     * Re-render JUST the metric pill + altered asterisk for one row.
     * Avoids a full _renderResults() so the user's expanded gear
     * preview, scroll position, popovers, etc. all stay put.
     */
    _refreshRowMetricDisplay(resultId) {
        const altered = this._alteredRows.get(String(resultId));
        if (!altered || altered.metricValue == null) return;
        // Find the pill — we use a result-row root that contains a button
        // with data-result-id and walk up to find the metric strip.
        const $btn = this._$el.find(`.stats-report-gear-toggle-btn[data-result-id="${resultId}"]`);
        if (!$btn.length) return;
        const $row = $btn.closest('.stats-report-result-row');
        const $pill = $row.find('.stats-report-metric-value').first();
        if (!$pill.length) return;
        const newVal = formatFixed(Number(altered.metricValue), 2);
        // Preserve the metric-label suffix (the tiny <span> at the end).
        const labelHtml = $pill.find('span').last().prop('outerHTML') || '';
        // Build asterisk + popover. The asterisk is a small superscript
        // info-icon-style glyph; clicking shows a popover explaining
        // the gearset has been altered after optimization.
        const altPopover = (
            'This row\'s gearset has been altered after optimization. ' +
            'The displayed value reflects your current selection, not the optimizer\'s pick. ' +
            'Other rows in this section keep their optimizer ranking.'
        ).replace(/"/g, '&quot;');
        const asteriskHtml = ` <sup class="stats-report-altered-asterisk travel-info-icon" data-info-title="Gearset altered" data-info-html="${altPopover}" style="color:#fff;font-weight:700;font-size:0.85em">*</sup>`;
        $pill.html(`${newVal} ${labelHtml}${asteriskHtml}`);
        // Re-wire the popover hook so clicking the asterisk opens the
        // info popover (wireInfoIcons is idempotent — skips already-wired).
        try { wireInfoIcons($row[0]); } catch (_) { /* non-fatal */ }
    }

    // ========================================================================
    // GEAR PREVIEW TOGGLE — collapsed by default, lazy-decode on expand
    // ========================================================================

    /**
     * Show/hide the gear preview tile for a result row. On first expand,
     * ensures the catalog is loaded (await api.getCatalog()) before
     * attempting to decode the export string. If decode still fails,
     * shows a clear error message instead of leaving an empty grid.
     */
    async _toggleGearPreview(resultId, $btn, instant = false) {
        const $container = this._$el.find(
            `.stats-report-gear-preview-container[data-result-id="${resultId}"]`
        );
        if (!$container.length) return;

        const $arrow = $btn.find('.stats-report-gear-toggle-arrow');
        const isExpanded = $btn.attr('data-expanded') === '1';

        if (isExpanded) {
            if (instant) { $container.hide(); } else { $container.slideUp(150); }
            $btn.attr('data-expanded', '0').removeClass('open');
            // Persist collapsed so it stays collapsed across re-render /
            // leave-and-return (mirrors section collapse persistence).
            this._setExpanded(`gear:${resultId}`, false);
            return;
        }

        // First-time expand: ensure catalog is loaded, then decode + render.
        // Cache the rendered HTML on the container's data attribute so
        // subsequent expands are instant.
        if (!$container.data('rendered')) {
            // Read gearset_export from DOM data attribute (immune to
            // this._results being replaced by a stale poll or re-render).
            const gearsetExport = $container.attr('data-gearset-export') || '';
            if (!gearsetExport) {
                $container.html('<div style="color:var(--text-muted);font-size:0.85em;padding:6px 0">No gearset data for this result.</div>');
                $container.data('rendered', '1');
            } else {
                // Catalog must be present for decodeGearsetSlots to work
                // (it looks up items by uuid in window.api._catalogCache).
                // On a cold page open this can race with stats report
                // poll → catalog hadn't finished loading. Force-await.
                try {
                    if (api && typeof api.getCatalog === 'function') {
                        await api.getCatalog();
                    }
                } catch (e) {
                    console.warn('[StatsReportPage] getCatalog() failed', e);
                }

                const slots = decodeGearsetSlots(gearsetExport);
                const previewInputs = this._parsePreviewInputs($container);
                // If the user has already edited this row's slots via
                // the in-place picker, render their merged slots
                // instead of the optimizer's original. _getCurrentSlots
                // returns the altered map when present, otherwise the
                // freshly-decoded one.
                const liveSlots = this._getCurrentSlots($container.data('result-id') || $container.attr('data-result-id'));
                const finalSlots = (liveSlots && Object.keys(liveSlots).length > 0) ? liveSlots : slots;
                // Merge optimizer's chosen pet/consumable into finalSlots
                // — they aren't carried in the export string. Must happen
                // AFTER the liveSlots/slots pick because _getCurrentSlots
                // re-decodes the same export (which never has pet/
                // consumable), so liveSlots is always non-empty and would
                // otherwise discard a merge done on `slots`. Mirrors
                // components/tree-node-card.js _renderGearPreview (~line
                // 605): without this overlay the optimizer's pet/
                // consumable picks were invisible in the mini-slot tiles
                // even though they showed in column 2 after Equip.
                //
                // 2026-06-02 (jwbail v2): condition was `!finalSlots.pet`,
                // which silently broke after _getCurrentSlots started
                // pre-merging the bare pet/consumable (commit 2754027c
                // — fix for the popup "No item equipped" bug). With the
                // pre-merge, finalSlots.pet exists but lacks icon_path,
                // so the enrichment block was skipped and the tile
                // rendered blank. Now we run the block when EITHER the
                // tile is missing entirely OR exists without an icon
                // (so we always set a usable icon_path).
                if (finalSlots) {
                    try {
                        const petAttrPv = $container.attr('data-optimized-pet') || '';
                        const consAttrPv = $container.attr('data-optimized-consumable') || '';
                        if (petAttrPv) {
                            const pet = JSON.parse(decodeURIComponent(petAttrPv));
                            if (pet && pet.name) {
                                // Pet icon needs deriving — worker only
                                // sends name/level/variant. Without this,
                                // pet rendered as a blank colored tile
                                // (no <img> tag because icon_path was
                                // empty). Mirrors tree-node-card.js's
                                // getPetIconPath call (~line 658). We
                                // also enrich max_level from the catalog
                                // so adult-stage pets get the adult icon
                                // instead of the juvenile fallback.
                                // Always resolve the user's actual pet variant
                                // and (re)compute the icon. The worker runs
                                // pool-wide and emits the default 'normal'
                                // variant icon, so gating this on a MISSING
                                // icon (old behavior) left a user who owns a
                                // light/dark/rare variant seeing the normal
                                // color in the small preview while the slot
                                // popup showed the correct one (jwbail
                                // 2026-06-15). Resolving unconditionally and
                                // overriding the worker's default icon fixes
                                // the mismatch; if the user only owns the
                                // normal variant this resolves to the same icon.
                                let iconPath = pet.icon_path || '';
                                {
                                    let maxLevel = pet.max_level || 0;
                                    // 2026-06-02 (jwbail): worker hardcodes
                                    // 'normal' for variant because it
                                    // runs pool-wide. Look the pet up
                                    // in the user's owned pets to see
                                    // if they have a light / dark / rare
                                    // variant of the same species and
                                    // use that — user's bug report:
                                    // "It's not showing the correct pet
                                    // icon, just the normal pet color
                                    // instead of the one I have like
                                    // light/dark/rare". Falls back to
                                    // pet.variant from worker (which
                                    // is always 'normal' today, but
                                    // future-proof) if the user has no
                                    // matching pet.
                                    let resolvedVariant = pet.variant || 'normal';
                                    try {
                                        // Read the user's chosen variant from the SAME
                                        // source the slot popup uses (getItemState):
                                        // ui.user_overrides.items[petId].variant, then
                                        // base items[petId].variant. The earlier fix read
                                        // store.state.character.pets, which doesn't hold
                                        // the variant — so the preview kept showing the
                                        // worker's pool-wide 'normal' while the popup
                                        // (this source) showed the right color (jwbail
                                        // 2026-06-15). Keyed by the pet's item id — the
                                        // worker sets itemId = name lowercased, spaces ->
                                        // underscores.
                                        const petId = pet.itemId
                                            || String(pet.name || '').toLowerCase().replace(/\s+/g, '_');
                                        const st = (typeof store !== 'undefined' && store.state) ? store.state : {};
                                        const ov = (((st.ui || {}).user_overrides || {}).items || {})[petId] || {};
                                        const base = (st.items || {})[petId] || {};
                                        const v = ov.variant !== undefined ? ov.variant
                                            : (base.variant !== undefined ? base.variant : null);
                                        if (v) resolvedVariant = v;
                                    } catch (_) { /* non-fatal */ }
                                    try {
                                        const catalog = window.api?._catalogCache;
                                        const catalogItems = (catalog && catalog.items) || [];
                                        const fullItem = catalogItems.find(it =>
                                            (it.name && it.name.toLowerCase() === pet.name.toLowerCase())
                                            || it.id === pet.itemId
                                            || it.uuid === pet.itemId);
                                        if (fullItem && fullItem.max_level) {
                                            maxLevel = fullItem.max_level;
                                        }
                                    } catch (_) { /* non-fatal */ }
                                    iconPath = getPetIconPath(
                                        pet.name,
                                        pet.level !== undefined ? pet.level : 0,
                                        resolvedVariant,
                                        maxLevel);
                                    // Also reflect the resolved variant
                                    // back onto the merged pet object so
                                    // downstream popup paths see the
                                    // user's actual variant.
                                    pet.variant = resolvedVariant;
                                }
                                // Replace finalSlots.pet entirely so the
                                // pre-merged bare object is overwritten
                                // with the fully-enriched one.
                                finalSlots.pet = {
                                    ...(finalSlots.pet || {}),
                                    ...pet,
                                    icon_path: iconPath,
                                    type: 'pet',
                                };
                            }
                        }
                        const consNeedsIcon = !finalSlots.consumable || !finalSlots.consumable.icon_path;
                        if (consAttrPv && consNeedsIcon) {
                            const cons = JSON.parse(decodeURIComponent(consAttrPv));
                            if (cons && cons.name) {
                                // Consumable icon: catalog lookup by id
                                // (worker stores itemId stripped to
                                // catalog form). Mirror tree-node-card
                                // approach so Fine consumables and rarity
                                // tinting work identically.
                                let iconPath = cons.icon_path || '';
                                let rarity = cons.rarity || 'common';
                                try {
                                    const catalog = window.api?._catalogCache;
                                    const catalogItems = (catalog && catalog.items) || [];
                                    const fullItem = catalogItems.find(it =>
                                        it.id === cons.itemId
                                        || it.uuid === cons.itemId
                                        || (it.name && cons.name && it.name.toLowerCase() === cons.name.toLowerCase()));
                                    if (fullItem) {
                                        if (!iconPath) iconPath = fullItem.icon_path || '';
                                        if (rarity === 'common' && fullItem.rarity) rarity = fullItem.rarity;
                                    }
                                } catch (_) { /* non-fatal */ }
                                finalSlots.consumable = {
                                    ...(finalSlots.consumable || {}),
                                    ...cons,
                                    icon_path: iconPath,
                                    rarity,
                                    type: 'consumable',
                                };
                            }
                        }
                    } catch (e) {
                        console.warn('[StatsReportPage] gear preview overlay parse failed:', e);
                    }
                }
                if (!finalSlots) {
                    $container.html(
                        '<div style="color:var(--text-muted);font-size:0.85em;padding:6px 0">' +
                        'Gear preview unavailable (catalog not loaded or invalid export).' +
                        '</div>'
                    );
                } else if (Object.keys(finalSlots).length === 0) {
                    $container.html(
                        '<div style="color:var(--text-muted);font-size:0.85em;padding:6px 0">' +
                        'Optimizer returned an empty gearset for this activity.' +
                        '</div>'
                    );
                } else {
                    $container.html(renderMiniGearPreview(finalSlots, { inputs: previewInputs }));
                }
                $container.data('rendered', '1');
            }
        }

        if (instant) { $container.show(); } else { $container.slideDown(150); }
        $btn.attr('data-expanded', '1').addClass('open');
        // Persist expanded so it re-opens across re-render / leave-and-return.
        this._setExpanded(`gear:${resultId}`, true);
    }

    // ========================================================================
    // EQUIP — load gearset to col 2 + select activity in col 3
    // ========================================================================

    /**
     * Find a result row in the in-memory _results map by ID.
     */
    _findResultById(resultId) {
        for (const cat of Object.keys(this._results)) {
            const arr = this._results[cat] || [];
            const found = arr.find(r => r.id === resultId);
            if (found) return found;
        }
        return null;
    }

    /**
     * Equip a stats report result: load its gearset to column 2 and
     * select the corresponding activity in column 3, then close the
     * stats report page so the user lands on the main view with
     * everything wired up.
     */
    async _equipResult(resultId, $btn) {
        console.log('[StatsReportPage:Equip] _equipResult ENTER resultId=', resultId);
        // Read gearset_export and activity name from DOM data attributes
        // (immune to this._results being replaced by a stale poll).
        const gearsetExport = $btn.attr('data-gearset-export') || '';
        const activityName = $btn.attr('data-activity-name') || '';
        // 2026-05-23: extraSlots payload — without these, the worker's
        // chosen pet/consumable are dropped on Equip because
        // encode_gearset() only serializes gear/tools/rings. User saw
        // bog_fishing_net 3.20 XP/step in the report vs 3.039 XP/step
        // when equipped (a 5.3% pet-XP delta). The worker now persists
        // optimized_pet / optimized_consumable in metrics_json and the
        // template URI-encodes them onto the button.
        const petAttr = $btn.attr('data-optimized-pet') || '';
        const consAttr = $btn.attr('data-optimized-consumable') || '';
        const inputAttr = $btn.attr('data-optimized-input') || '';
        let extraSlots = null;
        let optInput = null;
        try {
            if (petAttr) {
                const pet = JSON.parse(decodeURIComponent(petAttr));
                if (pet && pet.name) {
                    extraSlots = extraSlots || {};
                    extraSlots.pet = { ...pet, type: 'pet' };
                }
            }
            if (consAttr) {
                const cons = JSON.parse(decodeURIComponent(consAttr));
                if (cons && cons.name) {
                    extraSlots = extraSlots || {};
                    extraSlots.consumable = { ...cons, type: 'consumable' };
                }
            }
            if (inputAttr) {
                const inp = JSON.parse(decodeURIComponent(inputAttr));
                if (inp && inp.name) {
                    optInput = inp;
                }
            }
        } catch (parseErr) {
            console.warn('[StatsReportPage] failed to parse extraSlots data:', parseErr);
            extraSlots = null;
            optInput = null;
        }

        if (!gearsetExport) {
            api.showError('No gearset to equip on this result');
            return;
        }

        try {
            $btn.prop('disabled', true).text('Equipping…');

            // Load the gearset to column 2. Mirrors how the crafting tree
            // does it (components/crafting-tree-view.js _equipNode):
            // store.loadGearSetFromExport(exportString, null, name, extraSlots).
            const gearsetName = activityName || 'Goals Report Gearset';
            await store.loadGearSetFromExport(gearsetExport, null, gearsetName, extraSlots);

            // 2026-06-05 (jwbail): #4 — pre-populate column-2 slot
            // alternatives for the equipped gearset so its slot popups show
            // upgrades immediately instead of an "Optimize Slot & Equip"
            // button. Reuse the row's cached (anchored) alternatives if the
            // user opened a slot popup in the report; otherwise fetch them.
            //
            // 2026-06-05 (jwbail) bug fix: selectRecipe/selectActivity below
            // SYNCHRONOUSLY null store.state.gearsets.alternatives (the
            // dropdown selectors clear stale alts). On the FIRST equip the
            // fetch await happened to defer our write past that clear, so it
            // worked; on a RE-equip the cache is warm so the old write ran
            // synchronously BEFORE the selectors and got clobbered ("alts
            // gone, only Optimize Slot & Equip"). Fix: resolve the alts into
            // a promise here but DON'T write the store yet — write AFTER the
            // selection block so it always wins, warm cache or not.
            const _equipAltsReady = (async () => {
                try {
                    const found = this._findRow(resultId);
                    if (!found || !found.row) return null;
                    const equippedSlots = this._getCurrentSlots(resultId);
                    const gearsetKey = JSON.stringify(equippedSlots);
                    let entry = this._alternativesCache.get(String(resultId));
                    if (!entry || entry.gearsetKey !== gearsetKey || entry.pending) {
                        // Prefer worker-stored alts (correct-axis); endpoint
                        // only when the row was edited / none stored.
                        const stored = this._storedRowAlternatives(resultId, found.row, found.category);
                        if (stored) {
                            entry = {
                                alternatives: stored.alternatives,
                                lockedAlternatives: stored.lockedAlternatives,
                                gearsetKey,
                            };
                            this._alternativesCache.set(String(resultId), entry);
                            return entry;
                        }
                        const resp = await api.getStatsReportSlotAlternatives({
                            activity_name: found.row.activity_name,
                            skill_name: found.row.skill_name,
                            category: found.category,
                            chest_name: found.row.chest_name || null,
                            target_item: this._rowTargetItem(found.row, found.category),
                            gearset_slots: equippedSlots,
                        });
                        if (!resp || !resp.success) return null;
                        entry = {
                            alternatives: resp.alternatives || {},
                            lockedAlternatives: resp.locked_alternatives || {},
                            gearsetKey,
                        };
                        this._anchorAlternativesToRow(entry.alternatives, found.row, found.category);
                        this._anchorAlternativesToRow(entry.lockedAlternatives, found.row, found.category);
                        this._alternativesCache.set(String(resultId), entry);
                    }
                    return entry;
                } catch (altErr) {
                    console.warn('[StatsReportPage:Equip] alt resolve failed:', altErr);
                    return null;
                }
            })();

            // Apply auto-picked input item BEFORE activity selection,
            // matching components/crafting-tree-view.js _equipNodeGearset
            // (~line 3010-3020). When activity-info-section's activity-
            // change handler fires, it resets _selectedInputItems = {}
            // and then *restores* from store.state.column3.selectedInputItems
            // — provided the item's keywords match the slot's reference.
            // It then synchronously hands the restored map to
            // combinedStatsSection.setActivityAndLocation, which filters
            // by `item.stats`. So we must:
            //   (a) set the store BEFORE selecting the activity, and
            //   (b) build slot0 with a real `stats` field (otherwise the
            //       css filter drops it and the metric is calculated
            //       without the input's bonus — user-reported "puts the
            //       input slot there but doesn't equip it for the stats").
            // The worker only sends name/itemId/rarity/keywords on
            // optimized_input; we enrich `stats` from the equipment
            // catalog (already loaded for the gear preview pet/cons
            // overlay) so the input contributes to the metric.
            if (optInput) {
                let stats = null;
                let catalogIcon = '';
                let catalogRarity = '';
                try {
                    const catalog = window.api?._catalogCache;
                    const catalogItems = (catalog && catalog.items) || [];
                    const fullItem = catalogItems.find(it =>
                        it.id === optInput.itemId
                        || it.uuid === optInput.itemId
                        || (it.name && optInput.name && it.name.toLowerCase() === optInput.name.toLowerCase()));
                    if (fullItem) {
                        // Fine variants have a different stat block.
                        // Mirror item-selection-popup.js:413 — when the
                        // worker tagged is_fine, prefer stats_fine.
                        stats = (optInput.is_fine && fullItem.stats_fine)
                            ? fullItem.stats_fine
                            : (fullItem.stats || null);
                        catalogIcon = fullItem.icon_path || '';
                        catalogRarity = fullItem.rarity || '';
                    }
                } catch (_) { /* non-fatal — fall through with stats=null */ }
                const slot0 = {
                    name: optInput.name,
                    itemId: optInput.itemId,
                    rarity: catalogRarity || optInput.rarity || 'common',
                    keywords: optInput.keywords || [],
                    is_fine: !!optInput.is_fine,
                    icon_path: optInput.icon_path
                        || catalogIcon
                        || `/assets/icons/items/materials/${(optInput.name || '').replace(' (Fine)', '').replace(/ /g, '_').toLowerCase()}.svg`,
                    input_type: 'keyword',
                    input_reference: (optInput.keywords && optInput.keywords[0])
                        ? optInput.keywords[0].toLowerCase().replace(/ /g, '_')
                        : '',
                    is_generic: false,
                    stats: stats || {},  // CRITICAL — without this combinedStatsSection.setActivityAndLocation drops the item silently (line ~543: `if (item && item.stats)`).
                };
                console.log('[StatsReportPage:Equip] applying optInput', slot0,
                    'stats keys:', Object.keys(slot0.stats || {}));
                if (!store.state.column3) store.state.column3 = {};
                store.state.column3.selectedInputItems = { 0: slot0 };
                store._notifySubscribers('column3.selectedInputItems');
                try { store._saveColumn3Selection(); } catch (_) {}
            }

            // Select the activity in column 3 if we have an activity
            // name (every category except chests carries one). Use the
            // same id-from-name algorithm as ui/app.py:get_activities.
            // The activity-change handler will read selectedInputItems
            // from the store (set above) and synchronously pass them to
            // combinedStatsSection.setActivityAndLocation, which is what
            // calculates the metric the user sees in column 2.
            //
            // 2026-05-28 (jwbail): chests_recipes rows carry a recipe
            // name (e.g. "Cut a birch plank") in data-activity-name —
            // not an activity. Recipe IDs are NOT slugs of the recipe
            // name (the auto-generated module uses attr names like
            // BIRCH_PLANK whose .lower() gives 'birch_plank', completely
            // unrelated to "Cut a birch plank"). Look up the recipe by
            // name in window.recipeSelector.recipesData (already loaded
            // for the dropdown) and call selectRecipe with its id.
            // Without this branch the equip button cleared selectedRecipe
            // and tried to set selectedActivity to a non-existent id —
            // user-reported "equipping a chest finding recipe doesn't
            // select the recipe. It's just blank."
            const category = $btn.attr('data-category') || '';
            if (category === 'chests_recipes' && activityName) {
                const recipeId = _findRecipeIdByName(activityName);
                if (recipeId) {
                    // 2026-06-05 (jwbail): pre-select the service the report
                    // suggested so column 2 scores with the SAME service the
                    // optimizer used for the row. onRecipeChange ->
                    // loadServicesForRecipe restores store.state.column3
                    // .selectedService when it matches a location's
                    // service_id, so we resolve the worker's service NAME
                    // (+ location) to that location-specific id BEFORE
                    // selectRecipe fires. Without this the recipe loads but
                    // auto-picks the first Basic service, ignoring the
                    // report's suggestion (user-reported).
                    const svcName = ($btn.attr('data-optimized-service-name') || '').trim();
                    const svcLoc = ($btn.attr('data-optimized-service-location') || '').trim();
                    if (svcName) {
                        try {
                            const resp = await $.get(`/api/services/for-recipe/${recipeId}`);
                            const svc = (resp.services || []).find(s =>
                                (s.name || '').toLowerCase() === svcName.toLowerCase());
                            if (svc && Array.isArray(svc.locations) && svc.locations.length) {
                                let loc = null;
                                if (svcLoc) {
                                    const locLower = svcLoc.toLowerCase();
                                    const locSlug = locLower.replace(/ /g, '_').replace(/'/g, '');
                                    loc = svc.locations.find(l =>
                                        ((l.location && l.location.name) || '').toLowerCase() === locLower
                                        || ((l.location && l.location.id) || '').toLowerCase() === locSlug);
                                }
                                loc = loc || svc.locations.find(l => l.is_unlocked) || svc.locations[0];
                                if (loc && loc.service_id) {
                                    if (!store.state.column3) store.state.column3 = {};
                                    store.state.column3.selectedService = loc.service_id;
                                    if (loc.location && loc.location.id) {
                                        store.state.column3.selectedLocation = loc.location.id;
                                    }
                                }
                            }
                        } catch (svcErr) {
                            console.warn('[StatsReportPage:Equip] failed to resolve suggested service:', svcErr);
                        }
                    }
                    if (window.recipeSelector && typeof window.recipeSelector.selectRecipe === 'function') {
                        window.recipeSelector.selectRecipe(recipeId);
                    } else {
                        if (!store.state.column3) store.state.column3 = {};
                        store.state.column3.selectedRecipe = recipeId;
                        store.state.column3.selectedActivity = null;
                        store._notifySubscribers('column3.selectedRecipe');
                        store._notifySubscribers('column3.selectedActivity');
                        if (typeof store._saveColumn3Selection === 'function') {
                            store._saveColumn3Selection();
                        }
                    }
                } else {
                    console.warn(
                        '[StatsReportPage:Equip] could not resolve recipe id for name=', activityName,
                        '— recipeSelector.recipesData may not be loaded yet'
                    );
                }
            } else if (activityName) {
                const activityId = activityIdFromName(activityName);
                if (activityId) {
                    if (window.activitySelector && typeof window.activitySelector.selectActivity === 'function') {
                        window.activitySelector.selectActivity(activityId);
                    } else {
                        store.state.column3.selectedActivity = activityId;
                        store.state.column3.selectedRecipe = null;
                        store._notifySubscribers('column3.selectedActivity');
                        store._notifySubscribers('column3.selectedRecipe');
                        if (typeof store._saveColumn3Selection === 'function') {
                            store._saveColumn3Selection();
                        }
                    }
                }
            }

            // Now that the dropdown selectors have run (they synchronously
            // null gearsets.alternatives), write the prepopulated alts LAST
            // so they survive into the column-2 popups on every equip,
            // including a re-equip of the same set (warm cache). NOT awaited
            // — the .then microtask runs after this synchronous tail (the
            // selectors already ran above), so it wins the last write
            // without blocking navigation on the cold-cache fetch. See the
            // _equipAltsReady comment above.
            _equipAltsReady.then((_alts) => {
                if (!_alts) return;
                if (!store.state.gearsets) store.state.gearsets = {};
                store.state.gearsets.alternatives = _alts.alternatives || {};
                store.state.gearsets.lockedAlternatives = _alts.lockedAlternatives || {};
                store._notifySubscribers('gearsets.alternatives');
                store._notifySubscribers('gearsets.lockedAlternatives');
            }).catch(() => { /* non-fatal */ });

            api.showSuccess(`Equipped "${gearsetName}"`);
        } catch (err) {
            console.error('[StatsReportPage] Equip failed:', err);
            api.showError('Failed to equip gearset');
        } finally {
            $btn.prop('disabled', false).text('Equip');
            // Always close the stats report page so the user sees columns 2+3.
            // Hash routing in main.js handles the actual hide+show animation.
            window.location.hash = '';
        }
    }

    // ========================================================================
    // MERGE (add skills to existing run)
    // ========================================================================

    async _mergeSkill(skillName, category) {
        const uuid = store.state.session?.uuid;
        if (!uuid || !this._runId) return;
        try {
            const result = await api.mergeStatsReportJobs(uuid, this._runId, [category], [skillName]);
            if (result.success) {
                this._isRunning = true;
                this._totalJobs = result.total_jobs || this._totalJobs;
                this._lastProgressAt = Date.now();
                this._updateNavIconState('running');
                this._showProgressSection();
                this._startPolling();
            } else {
                api.showError(result.error || 'Failed to add skill to run');
            }
        } catch (err) {
            api.showError('Failed to add skill to run');
        }
    }

    // ========================================================================
    // NAV ICON STATE
    // ========================================================================

    _updateNavIconState(state) {
        this._navIconState = state;
        // 2026-06-02 (jwbail): keep the Optimize All button's running
        // visual in sync with the run state. When state goes 'running',
        // the button shows the rotating hourglass (matches the column-2
        // and crafting-tree optimize buttons). When 'idle' or 'unread',
        // it returns to the play-icon + 'Optimize All' label.
        try { this._updateOptimizeButtonRunningState(); } catch (_) {}
        const $btn = $('#stats-report-nav-btn');
        const $spinner = $btn.find('.stats-report-spinner');
        const $badge = $btn.find('.stats-report-badge');

        $spinner.hide();
        $badge.hide();
        // 2026-05-26 (jwbail): drop the running marker class regardless of
        // new state, then re-add only when entering 'running'. CSS hides
        // the topbar stale (!) badge while this class is present so even
        // if the stale annotator re-runs mid-run it can't surface the
        // badge over the spinner.
        $btn.removeClass('stats-report-nav-running');

        if (state === 'running') {
            $spinner.show();
            $btn.addClass('stats-report-nav-running');
        } else if (state === 'unread') {
            $badge.show();
            // 2026-06-02 (jwbail): persist so the badge survives page
            // reload until the user actually opens the goals report.
            // Without this, F5 / browser-restart silently dismissed the
            // "you have an unread completion" indicator the user asked
            // to keep visible across reloads.
            try { localStorage.setItem('stats_report_unread', '1'); } catch (_) {}
        }
        // Any non-'unread' state clears the persistence flag — 'idle'
        // means the user has acknowledged (opened the report), 'running'
        // means a fresh run is already replacing the prior result.
        if (state !== 'unread') {
            try { localStorage.removeItem('stats_report_unread'); } catch (_) {}
        }
    }

    /**
     * 2026-06-02 (jwbail): on construction, restore the unread badge if
     * a previous session left it set. _loadInitialStatus runs async via
     * onNavigatedTo and won't set 'unread' for a complete-but-unviewed
     * run (it only sets 'unread' on a running→complete transition). The
     * badge needs to be visible BEFORE the user navigates, so we hydrate
     * directly from localStorage at construction time.
     */
    _hydrateUnreadFromStorage() {
        try {
            if (localStorage.getItem('stats_report_unread') === '1') {
                this._navIconState = 'unread';
                const $badge = $('#stats-report-nav-btn').find('.stats-report-badge');
                $badge.show();
            }
        } catch (_) { /* localStorage unavailable */ }
    }

    /**
     * 2026-06-02 (jwbail): one-shot poll of /api/stats-report/status at
     * construction time so the nav header's spinner is visible on the
     * very first paint of a page reload while a run is in progress.
     *
     * Without this, neither _hydrateUnreadFromStorage nor the 10 s
     * background poll fires until the user opens the goals report
     * page (which calls _loadInitialStatus). The background poll
     * specifically guards against doing work when the page already
     * thinks no run is active — that's the case right after F5.
     *
     * Best-effort: any error (no session yet, network blip, etc.)
     * is silently swallowed because this is purely a UI hint —
     * the regular onNavigatedTo polling will still pick the state
     * up the moment the user opens the page.
     */
    async _hydrateRunningStateFromServer() {
        try {
            const uuid = store.state.session?.uuid;
            if (!uuid) return;
            const status = await api.getStatsReportStatus(uuid);
            if (!status || !status.success) return;
            if (status.status === 'running') {
                this._isRunning = true;
                this._totalJobs = status.total_jobs || 0;
                this._completedJobs = status.completed_jobs || 0;
                this._runId = status.run_id || null;
                this._startedAt = status.started_at || null;
                // _updateNavIconState transitively calls
                // _updateOptimizeButtonRunningState so the optimize
                // button also reflects the running state on first
                // paint (Issue 4 fix in same change).
                this._updateNavIconState('running');
            }
        } catch (_) { /* non-fatal — onNavigatedTo will catch up */ }
    }

    // ========================================================================
    // BACKGROUND POLL (for nav icon state when page is closed)
    // ========================================================================

    _startBackgroundPoll() {
        // Poll every 10s to keep nav icon in sync even when page is closed
        setInterval(async () => {
            if (this._isPageOpen) return; // Page handles its own polling
            if (!this._isRunning && this._navIconState !== 'running') return;

            const uuid = store.state.session?.uuid;
            if (!uuid) return;

            try {
                const status = await api.getStatsReportStatus(uuid);
                if (!status.success) return;

                if (status.status === 'running') {
                    this._isRunning = true;
                    this._updateNavIconState('running');
                } else if (status.status === 'complete' && this._isRunning) {
                    this._isRunning = false;
                    this._updateNavIconState('unread');
                    // 2026-06-02 (jwbail): mirror the page-open path —
                    // refresh stale annotations so the topbar (!) clears
                    // immediately when the run completes, instead of
                    // sticking around until the next navigation.
                    try { window.dispatchEvent(new CustomEvent('stats-report-stale-refresh')); } catch (_) {}
                    // Show toast
                    api.showSuccess('Goals report complete — your optimization report is ready to view', {
                        onClick: () => { window.location.hash = '#goals-report'; }
                    });
                } else if (status.status === 'failed' && this._isRunning) {
                    this._isRunning = false;
                    this._updateNavIconState('idle');
                    api.showError('Goals report failed. Check server logs and try again.');
                }
            } catch (err) {
                // Ignore background poll errors
            }
        }, 10000);
    }
}

export default StatsReportPage;
