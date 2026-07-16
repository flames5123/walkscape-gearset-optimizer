/**
 * walkdle-engine.js
 *
 * Pure, dependency-free engine for the Walkdle "Guess the Item" daily puzzle.
 *
 * Two responsibilities:
 *   1. Deterministic daily target selection (everyone gets the same item on a
 *      given UTC date; old dates are replayable by passing that date string).
 *   2. Attribute-by-attribute guess comparison (Squirdle-style green / yellow /
 *      absent + up/down arrows for ordinal attributes).
 *
 * The item pool comes from GET /api/walkdle/catalog (see ui/walkdle_catalog.py),
 * already sorted ascending by stable item id. The catalog grows append-only
 * (new items get higher ids), so the id-sorted order — and therefore the seeded
 * pick for any past date — is stable and identical across clients.
 *
 * SOURCE is multi-valued (buy / craft / activity / chest): an item can have
 * several. It is compared as a set: green = exact same set, yellow = non-empty
 * intersection, absent = disjoint. Skills and keywords are compared the same way.
 */

import { SEED_WORDS } from './walkdle-words.js';

// --- Seeded PRNG (xmur3 hash -> mulberry32 generator) -----------------------

export function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** UTC date string YYYY-MM-DD for a Date (defaults to now). */
export function utcDateString(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

/** Stable integer puzzle number for display (day 1 = WALKDLE_START_DATE, UTC). */
export function dailyNumber(dateStr) {
    const epoch = Date.parse(WALKDLE_START_DATE + 'T00:00:00Z');
    const day = Date.parse(dateStr + 'T00:00:00Z');
    if (Number.isNaN(day)) return 0;
    return Math.floor((day - epoch) / 86400000) + 1;
}

/**
 * Pick the deterministic target for a date from the id-sorted pool.
 * Defensive copy + re-sort by id so callers can't perturb the contract.
 */
export function pickDailyTarget(dateStr, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const pool = items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const n = pool.length;
    // Deterministic permutation of the whole pool with a FIXED seed (identical
    // for every date and client). Day N takes the N-th slot of the shuffle, so
    // an item cannot repeat until the entire pool has been used (≈ poolSize
    // days). The previous approach picked an independent random index per date,
    // which collides early (birthday paradox) — e.g. day 2 and day 5 matched.
    const order = pool.map((_, i) => i);
    const rand = mulberry32(xmur3('walkdle-shuffle-v1')());
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
    }
    const dayIndex = dailyNumber(dateStr) - 1;  // 0-based offset from day 1
    const pos = ((dayIndex % n) + n) % n;
    return pool[order[pos]] || pool[0];
}

// --- Random / seed mode -----------------------------------------------------

// Random mode is a curated word game: every catalog item has exactly ONE seed
// word (a bijection), and only supported words resolve. word[i] (SEED_WORDS,
// see walkdle-words.js) maps to the i-th item in a stable, append-only order
// (_seedOrder below). SEED_WORDS is longer than the pool, so trailing words are
// "not yet assigned" until the catalog grows to reach them. Unknown or
// not-yet-assigned words resolve to null so the UI can substitute a random
// valid seed. The order uses its own salt, decoupled from the daily schedule,
// so a solved random seed never leaks a future daily answer.

/** Normalize a user-entered seed: lowercase, [a-z0-9] only, max 8 chars. */
export function sanitizeSeed(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
}

// word -> index in SEED_WORDS (first occurrence wins), built once.
let _seedWordIndex = null;
function _wordIndex(word) {
    if (!_seedWordIndex) {
        _seedWordIndex = new Map();
        for (let i = 0; i < SEED_WORDS.length; i++) {
            if (!_seedWordIndex.has(SEED_WORDS[i])) _seedWordIndex.set(SEED_WORDS[i], i);
        }
    }
    return _seedWordIndex.has(word) ? _seedWordIndex.get(word) : -1;
}

// Pool-size-independent per-item key for the seed order. Distinct salt from the
// daily schedule's _itemKey01 so the two orders don't correlate.
function _seedItemKey01(id) {
    return mulberry32(xmur3('walkdle-seedword-key:' + String(id))())();
}

let _seedOrderCache = null;  // { sig, order: [itemId, ...] }

// Stable, append-only item order that word #i is assigned to. Launch-cohort
// items (first_seen <= start) are shuffled with a fixed independent salt; later
// items are appended in (first_seen, key, id) order so an item added later can
// never shift an already-assigned word. Falls back to id-sort if the catalog
// carries no first_seen dates.
function _buildSeedOrder(items) {
    const LAUNCH = WALKDLE_START_DATE;
    if (!items.some((it) => it.first_seen)) {
        return items.slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .map((it) => it.id);
    }
    const launch = items
        .filter((it) => (it.first_seen || LAUNCH) <= LAUNCH)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const ord = launch.map((_, i) => i);
    const rand = mulberry32(xmur3('walkdle-seedword-order-v1')());
    for (let i = ord.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = ord[i]; ord[i] = ord[j]; ord[j] = t;
    }
    const order = ord.map((pos) => launch[pos].id);
    const later = items
        .filter((it) => (it.first_seen || LAUNCH) > LAUNCH)
        .sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen))
            || (_seedItemKey01(a.id) - _seedItemKey01(b.id))
            || String(a.id).localeCompare(String(b.id)));
    for (const it of later) order.push(it.id);
    return order;
}

function _seedOrder(items) {
    const sig = _scheduleSignature(items);
    if (!_seedOrderCache || _seedOrderCache.sig !== sig) {
        _seedOrderCache = { sig, order: _buildSeedOrder(items) };
    }
    return _seedOrderCache.order;
}

/**
 * Deterministic target item for a seed word, or null if the word is not a
 * supported/assigned seed. word[i] resolves to the i-th item in _seedOrder;
 * words past the current pool size are valid words that aren't assigned yet.
 */
export function pickTargetForSeed(seed, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const idx = _wordIndex(sanitizeSeed(seed));
    if (idx < 0) return null;                 // unsupported word
    const order = _seedOrder(items);
    if (idx >= order.length) return null;     // supported word, not yet assigned an item
    const id = order[idx];
    return items.find((it) => it.id === id) || null;
}

/** True iff `seed` is a supported word currently assigned to an item. */
export function isValidSeed(seed, items) {
    return pickTargetForSeed(seed, items) != null;
}

/**
 * A random VALID seed word (one currently assigned to an item). With no/empty
 * pool, falls back to any word from the list.
 */
export function randomSeed(items) {
    if (Array.isArray(items) && items.length > 0) {
        const n = Math.min(SEED_WORDS.length, _seedOrder(items).length);
        if (n > 0) return SEED_WORDS[Math.floor(Math.random() * n)];
    }
    return SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
}

/**
 * The seed words currently assigned to an item (word[i] for i < pool size), in
 * list order. Used by the archive browser to list every playable seed. Sort a
 * copy for display — list order is the item-mapping contract, not a view order.
 */
export function validSeedWords(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const n = Math.min(SEED_WORDS.length, _seedOrder(items).length);
    return SEED_WORDS.slice(0, n);
}

// --- Stable per-day schedule (pinned; survives pool growth) ------------------
//
// Each item gets a fixed, pool-size-independent key (a hash of its id) and a
// first_seen release date. The daily schedule is a draw-without-replacement in
// key order, skipping items not yet released. Properties:
//   * past days never change when items are added (a day's pick depends only on
//     items released by then + earlier picks, all of which are fixed),
//   * no repeats until the available pool is exhausted (≈ #items days),
//   * recomputed on the fly from (id, first_seen) — nothing is stored per day.
// Launch-cohort items (first_seen <= WALKDLE_START_DATE) are keyed to their
// position in the original walkdle-shuffle-v1 permutation, so the schedule that
// is already live is preserved exactly; later additions only insert going
// forward. If items lack first_seen, callers fall back to pickDailyTarget.

function _itemKey01(id) {
    return mulberry32(xmur3('walkdle-key:' + String(id))())();
}

function _scheduleSignature(items) {
    let h = 0;
    for (const it of items) {
        const k = (it.id || '') + '|' + (it.first_seen || '');
        for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
    }
    return items.length + ':' + (h >>> 0);
}

let _stableSched = null;  // { sig, days: [itemId, ...] }

function _buildStableSchedule(items, uptoDay) {
    const LAUNCH = WALKDLE_START_DATE;
    // Launch cohort, id-sorted, keyed to the original permutation so the
    // already-live schedule is reproduced exactly.
    const launch = items
        .filter((it) => (it.first_seen || LAUNCH) <= LAUNCH)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const L = launch.length;
    const order = launch.map((_, i) => i);
    const rand = mulberry32(xmur3('walkdle-shuffle-v1')());
    for (let i = L - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const launchKey = {};
    for (let pos = 0; pos < L; pos++) launchKey[launch[order[pos]].id] = pos;

    const entries = items.map((it) => {
        const fs = it.first_seen || LAUNCH;
        const isLaunch = fs <= LAUNCH;
        return {
            id: it.id,
            key: isLaunch ? launchKey[it.id] : (L * _itemKey01(it.id)),
            relDay: Math.max(0, dailyNumber(fs) - 1),  // 0-based release day
        };
    });
    entries.sort((a, b) => a.key - b.key || String(a.id).localeCompare(String(b.id)));

    const used = new Array(entries.length).fill(false);
    const days = [];
    let ptr = 0;
    for (let d = 0; d <= uptoDay; d++) {
        while (ptr < entries.length && used[ptr]) ptr++;
        let chosen = -1;
        for (let i = ptr; i < entries.length; i++) {
            if (used[i] || entries[i].relDay > d) continue;  // used or not yet released
            chosen = i;
            break;
        }
        if (chosen === -1) {
            // Released pool exhausted (beyond the no-repeat horizon): cycle
            // deterministically so the game still has a daily target.
            days.push(entries.length ? entries[d % entries.length].id : null);
            continue;
        }
        used[chosen] = true;
        if (chosen === ptr) ptr++;
        days.push(entries[chosen].id);
    }
    return days;
}

/** Stable daily target: pinned per day, survives pool growth (see above). */
export function pickDailyTargetStable(dateStr, items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    if (!items.some((it) => it.first_seen)) return pickDailyTarget(dateStr, items);
    const wantDay = dailyNumber(dateStr) - 1;
    if (wantDay < 0) return pickDailyTarget(dateStr, items);
    const sig = _scheduleSignature(items);
    if (!_stableSched || _stableSched.sig !== sig || _stableSched.days.length <= wantDay) {
        _stableSched = { sig, days: _buildStableSchedule(items, wantDay) };
    }
    const id = _stableSched.days[wantDay];
    if (id == null) return pickDailyTarget(dateStr, items);
    return items.find((it) => it.id === id) || pickDailyTarget(dateStr, items);
}

// --- Comparison helpers -----------------------------------------------------

function ordinal(guessVal, targetVal) {
    // Null/undefined on either side is not comparable — neutral absent.
    if (guessVal == null || targetVal == null) return { state: 'absent', dir: null };
    const g = Number(guessVal) || 0;
    const t = Number(targetVal) || 0;
    if (g === t) return { state: 'green', dir: null };
    // Not equal → blue cell with an up/down arrow toward the answer.
    return { state: 'blue', dir: t > g ? 'up' : 'down' };
}

function setCompare(guessArr, targetArr) {
    const g = new Set(guessArr || []);
    const t = new Set(targetArr || []);
    if (g.size === t.size && [...g].every((x) => t.has(x))) {
        return { state: 'green' };
    }
    const intersects = [...g].some((x) => t.has(x));
    return { state: intersects ? 'yellow' : 'red' };
}

function exactCompare(guessVal, targetVal) {
    return { state: guessVal === targetVal ? 'green' : 'red' };
}

/**
 * Column definitions, in display order. Each column knows how to extract its
 * value from an item and how to compare. `kind` drives rendering:
 *   ordinal  -> green or absent + up/down arrow
 *   set      -> green / yellow / absent (multi-valued)
 *   exact    -> green / absent (single categorical)
 */
// Tier names by index (0..5). Quality and rarity are parallel scales: one tier
// index maps to both a quality name and a rarity name (e.g. 3 -> Excellent/Epic).
const TIER_QUALITY_NAMES = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
const TIER_RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Ethereal'];

/** Combined "Quality/Rarity" label for an item's unified tier (e.g. "Excellent/Epic"). */
function tierLabel(it) {
    const i = it.tier_index;
    if (i == null || i < 0 || i >= TIER_QUALITY_NAMES.length) return it.tier || it.rarity || '—';
    return `${TIER_QUALITY_NAMES[i]}/${TIER_RARITY_NAMES[i]}`;
}

export const WALKDLE_COLUMNS = [
    { key: 'tier', label: 'Rarity/Quality', kind: 'ordinal', ordKey: 'tier_index', display: (it) => tierLabel(it) },
    { key: 'slot', label: 'Slot', kind: 'exact', display: (it) => it.slot || '—' },
    { key: 'sources', label: 'Source', kind: 'set', display: (it) => (it.sources || []).join(', ') || '—' },
    { key: 'skills', label: 'Skills', kind: 'set', display: (it) => (it.skills || []).join(', ') || '—' },
    { key: 'stat_count', label: 'Stats', kind: 'ordinal', ordKey: 'stat_count', display: (it) => String(it.stat_count) },
    { key: 'level_req', label: 'Level', kind: 'ordinal', ordKey: 'level_req', kindKey: 'level_kind', display: (it) => it.level_display || String(it.level_req) },
    { key: 'value', label: 'Value', kind: 'ordinal', ordKey: 'value', display: (it) => String(it.value) },
    { key: 'keywords', label: 'Keywords', kind: 'set', display: (it) => (it.keywords || []).join(', ') || '—' },
];

/** Human-friendly item label (appends quality for crafted entries). */
export function displayName(item) {
    if (!item) return '';
    return item.quality ? `${item.name} (${item.quality})` : item.name;
}

// --- Date navigation helpers ------------------------------------------------

export const WALKDLE_START_DATE = '2026-06-15';

export function addDays(dateStr, n) {
    const ms = Date.parse(dateStr + 'T00:00:00Z') + n * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
}

/** Clamp a date string into [WALKDLE_START_DATE, today] (UTC). */
export function clampDate(dateStr, todayStr = utcDateString()) {
    if (dateStr < WALKDLE_START_DATE) return WALKDLE_START_DATE;
    if (dateStr > todayStr) return todayStr;
    return dateStr;
}

/**
 * Compare a guess item against the target. Returns an array (one entry per
 * WALKDLE_COLUMNS) plus a top-level `solved` flag.
 */
export function compareGuess(guess, target) {
    const cells = WALKDLE_COLUMNS.map((col) => {
        let result;
        if (col.kind === 'ordinal') {
            result = ordinal(guess[col.ordKey], target[col.ordKey]);
            // Equal numeric value but a different requirement KIND (e.g. a flat
            // level 45 vs "45% artisan") is only a partial match, not exact.
            if (result.state === 'green' && col.kindKey
                && guess[col.kindKey] !== target[col.kindKey]) {
                result = { state: 'yellow', dir: null };
            }
        } else if (col.kind === 'set') {
            result = setCompare(guess[col.key], target[col.key]);
        } else {
            result = exactCompare(guess[col.key], target[col.key]);
        }
        return {
            key: col.key,
            label: col.label,
            kind: col.kind,
            display: col.display(guess),
            state: result.state,
            dir: result.dir || null,
        };
    });
    return { id: guess.id, name: displayName(guess), icon: guess.icon, cells, solved: guess.id === target.id };
}

/** Emoji/arrow share glyph for a cell (spoiler-free share string). */
export function cellGlyph(cell, highContrast) {
    if (cell.kind === 'ordinal' && cell.dir === 'up') return '⬆️';
    if (cell.kind === 'ordinal' && cell.dir === 'down') return '⬇️';
    if (cell.state === 'green') return highContrast ? '🟧' : '🟩';
    if (cell.state === 'yellow') return highContrast ? '🟦' : '🟨';
    return '⬛'; // no match / non-comparable -> gray (black square) in both modes
}

/** Build the spoiler-free share string for a finished/abandoned game. */
export function buildShareString(dateStr, guessResults, solved, maxGuesses, highContrast, seed, modeLabel) {
    const base = solved ? `${guessResults.length}/${maxGuesses}` : `X/${maxGuesses}`;
    const count = modeLabel ? `${base} (${modeLabel})` : base;
    const header = seed ? `Walkdle Random (${seed})` : `Walkdle #${dailyNumber(dateStr)}`;
    const grid = guessResults.map((g) => g.cells.map((c) => cellGlyph(c, highContrast)).join('')).join('\n');
    return `https://walkscape.flamesandvoltiply.com\n${header} ${count}\n${grid}`;
}

/**
 * Scoredle-style narrowing: for each guess (in order), how many catalog items
 * are still consistent with all the hints revealed so far. A candidate C is
 * still possible iff, for every guess g, comparing g against C would have
 * produced the same colored result the player actually saw (because if C were
 * the answer, that guess would yield those exact hints).
 *
 * guessItems[i] is the item object that was guessed for guessResults[i].
 * Returns an array of remaining counts, one per guess.
 */
export function remainingCounts(guessResults, guessItems, allItems) {
    let candidates = allItems.slice();
    const counts = [];
    for (let i = 0; i < guessResults.length; i++) {
        const gi = guessItems[i];
        const want = guessResults[i].cells;
        if (!gi) { counts.push(candidates.length); continue; }
        candidates = candidates.filter((c) => {
            const got = compareGuess(gi, c).cells;
            for (let k = 0; k < want.length; k++) {
                if (got[k].state !== want[k].state) return false;
                if ((got[k].dir || null) !== (want[k].dir || null)) return false;
            }
            return true;
        });
        counts.push(candidates.length);
    }
    return counts;
}

/** Scoredle share: the normal emoji grid with the remaining-candidate count to
 *  the right of each guess row. */
export function buildScoredleString(dateStr, guessResults, guessItems, allItems, solved, maxGuesses, highContrast, seed, modeLabel) {
    const base = solved ? `${guessResults.length}/${maxGuesses}` : `X/${maxGuesses}`;
    const count = modeLabel ? `${base} (${modeLabel})` : base;
    const header = seed ? `Walkdle Scoredle Random (${seed})` : `Walkdle Scoredle #${dailyNumber(dateStr)}`;
    const counts = remainingCounts(guessResults, guessItems, allItems);
    const grid = guessResults
        .map((g, i) => `${g.cells.map((c) => cellGlyph(c, highContrast)).join('')} ${counts[i]}`)
        .join('\n');
    return `https://walkscape.flamesandvoltiply.com\n${header} ${count}\n${grid}`;
}

// --- Smart filter ----------------------------------------------------------
//
// buildSmartFilter() condenses the feedback from ALL prior guesses into one
// advanced-query string for the guess box. The string uses the exact grammar
// that parseWalkdleQuery (utils/walkdle-query.js) already understands, so the
// "Make smart filter" button just writes a query the box can read:
//
//   rarity>great rarity<eternal   tier (Rarity/Quality) bounds, names accepted
//   rarity:perfect                tier locked exactly
//   value>65 value<150 value:156  coin-value bounds / exact
//   stats>2  level<40             stat-count / level-req bounds
//   craft  !chest                 plain-word includes / excludes (matched against
//                                 the box haystack: name/slot/rarity/source/skills)
//
// Mapping from per-column feedback:
//   ordinal (tier/value/stats/level): green -> exact; up -> lower bound (keep the
//     largest, the tightest); down -> upper bound (keep the smallest).
//   exact slot: green -> require the slot word; mismatch (red) -> exclude it.
//   set sources/skills: green -> every member is present (include all); yellow ->
//     include the single member when unambiguous; disjoint (red) -> exclude all.
//   keywords: intentionally ignored.

// Ordinal columns -> query token name + comparable number + embedded label.
const SMART_ORDINALS = {
    tier: { token: 'rarity', ord: (it) => Number(it.tier_index) || 0, label: (it) => (TIER_QUALITY_NAMES[it.tier_index] || '').toLowerCase() },
    value: { token: 'value', ord: (it) => Number(it.value) || 0, label: (it) => String(Number(it.value) || 0) },
    stat_count: { token: 'stats', ord: (it) => Number(it.stat_count) || 0, label: (it) => String(Number(it.stat_count) || 0) },
    level_req: { token: 'level', ord: (it) => Number(it.level_req) || 0, label: (it) => String(Number(it.level_req) || 0) },
};

// Multi-valued set columns rendered as plain-word membership tokens. The order
// here also drives the token order in the output (sources before skills).
const SMART_SET_KEYS = ['sources', 'skills'];

/**
 * Build an advanced-query string from all prior guess results.
 *   guessResults: array of compareGuess() outputs (cells carry key/state/dir).
 *   itemsById:    map of item id -> raw catalog item (the guessed item's values).
 * Returns a (possibly empty) space-separated token string.
 */
export function buildSmartFilter(guessResults, itemsById) {
    const byId = itemsById || {};
    const ord = {}; // token -> { lower, upper, exact }, each {idx,label}|null
    for (const k of Object.keys(SMART_ORDINALS)) {
        ord[SMART_ORDINALS[k].token] = { lower: null, upper: null, exact: null };
    }
    let slotExact = null;
    const slotExcl = new Set();
    const setPos = new Set(); // confirmed-present source/skill words
    const setNeg = new Set(); // confirmed-absent source/skill words

    for (const g of (guessResults || [])) {
        const raw = byId[g && g.id];
        if (!raw || !Array.isArray(g.cells)) continue;
        for (const cell of g.cells) {
            if (SMART_ORDINALS[cell.key]) {
                const meta = SMART_ORDINALS[cell.key];
                const acc = ord[meta.token];
                const idx = meta.ord(raw);
                const label = meta.label(raw);
                if (cell.state === 'green') {
                    acc.exact = { idx, label };
                } else if (cell.dir === 'up') {
                    if (!acc.lower || idx > acc.lower.idx) acc.lower = { idx, label };
                } else if (cell.dir === 'down') {
                    if (!acc.upper || idx < acc.upper.idx) acc.upper = { idx, label };
                }
                continue;
            }
            if (cell.key === 'slot') {
                const v = String(raw.slot || '').toLowerCase();
                if (!v) continue;
                if (cell.state === 'green') slotExact = v;
                else if (cell.state === 'red') slotExcl.add(v);
                continue;
            }
            if (SMART_SET_KEYS.includes(cell.key)) {
                const members = (raw[cell.key] || []).map((m) => String(m).toLowerCase()).filter(Boolean);
                if (members.length === 0) continue;
                if (cell.state === 'green') {
                    members.forEach((m) => setPos.add(m));
                } else if (cell.state === 'yellow') {
                    if (members.length === 1) setPos.add(members[0]); // unambiguous overlap
                } else if (cell.state === 'red') { // disjoint
                    members.forEach((m) => setNeg.add(m));
                }
                continue;
            }
            // keywords (and anything else) intentionally ignored.
        }
    }

    // Assemble. Positive words win over negatives; everything de-duped.
    const pos = new Set();
    const neg = new Set();
    if (slotExact) pos.add(slotExact);
    else slotExcl.forEach((s) => neg.add(s));
    setPos.forEach((m) => pos.add(m));
    setNeg.forEach((m) => { if (!pos.has(m)) neg.add(m); });

    const tokens = [];
    const emitOrd = (token) => {
        const acc = ord[token];
        if (!acc) return;
        if (acc.exact) { tokens.push(`${token}:${acc.exact.label}`); return; }
        if (acc.lower) tokens.push(`${token}>${acc.lower.label}`);
        if (acc.upper) tokens.push(`${token}<${acc.upper.label}`);
    };

    emitOrd('rarity');
    emitOrd('value');
    emitOrd('stats');
    emitOrd('level');
    // Wrap multi-word values in quotes so they survive as one token (the parser
    // and "!phrase" negation both accept "quoted phrases").
    const q = (w) => (/\s/.test(w) ? `"${w}"` : w);
    [...pos].sort().forEach((m) => tokens.push(q(m)));
    [...neg].sort().forEach((m) => tokens.push(`!${q(m)}`));

    return tokens.join(' ');
}
