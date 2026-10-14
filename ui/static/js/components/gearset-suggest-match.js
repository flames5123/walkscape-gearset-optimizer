/**
 * Gearset Suggest Match — pure resolver module.
 *
 * Given a saved gear-set NAME, resolves it to a single target
 * (activity, recipe, or travel route) using name-based matching.
 *
 * Exported function is dependency-free and unit-testable under node:test.
 */

/**
 * Normalize a string: lowercase, trim, collapse internal whitespace.
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Strip a single trailing 's' for plural-insensitive compare.
 * @param {string} s - already normalized
 * @returns {string}
 */
function depluralize(s) {
    return s.endsWith('s') ? s.slice(0, -1) : s;
}

/**
 * Compare two normalized strings with plural-insensitivity:
 * matches if either as-is OR both depluralized forms match.
 * @param {string} a - normalized
 * @param {string} b - normalized
 * @returns {boolean}
 */
function pluralMatch(a, b) {
    if (a === b) return true;
    return depluralize(a) === depluralize(b);
}

/**
 * Strip the auto-generated suffix that the optimization "Save" feature appends
 * to gear-set names, e.g.:
 *   "Cut a birch plank - 2026-07-02 20:56 [Steps/Target Item > Expected Steps/Craft]"
 *   -> "Cut a birch plank"
 *   "Rescue team - 2026-08-13 20:10 [Steps/Target > Total XP/Step]"
 *   -> "Rescue team"
 *   "Cook meat - 2026-08-18 21:33 [Materials/Craft > Expected Steps/Craft] (1)"
 *   -> "Cook meat"
 * Removes (in order) a trailing " (N)" copy-disambiguation suffix (appended when
 * a duplicate name is saved), a trailing "[ ... ]" metric bracket, and a trailing
 * " - <YYYY-MM-DD[ HH:MM[:SS]]>" timestamp. Returns the trimmed base.
 *
 * The order matters: the " (N)" copy suffix lands AFTER the "[metric]" bracket,
 * so it must be stripped first — otherwise the "[ ... ]$"-anchored bracket regex
 * never matches, the whole suffix survives, and the base-name retry in
 * resolveGearsetTarget is skipped (base === name). This was the root cause of
 * saved sets like "Cook meat - ... [ ... ] (1)" not resolving to their recipe.
 * @param {string} name
 * @returns {string}
 */
function stripAutoGenSuffix(name) {
    let s = name;
    // Trailing copy-disambiguation suffix: " (1)", " (2)", ... appended when a
    // set is saved under an already-used name. Strip repeatedly in case of
    // stacked copies (e.g. " (1) (2)").
    let prev;
    do {
        prev = s;
        s = s.replace(/\s*\(\d+\)\s*$/, '');
    } while (s !== prev);
    // Trailing metric bracket: " [ ... ]" at end.
    s = s.replace(/\s*\[[^\]]*\]\s*$/, '');
    // Trailing optimization-save timestamp: " - 2026-07-02 20:56" (time optional).
    s = s.replace(/\s+-\s+\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\s*$/, '');
    return s.trim();
}

/**
 * Travel regex: handles 'Travel: A -> B', 'A -> B', 'A → B', 'A to B'
 * (with optional 'travel' prefix and colon).
 */
const TRAVEL_RE = /^(?:travel\s*:?\s*)?(.+?)\s*(?:->|→|\bto\b)\s*(.+)$/i;

/**
 * Collect all candidate targets that a given name resolves to, across
 * (valid travel) + (non-scrap recipes) + (activities).
 * @param {string} rawName
 * @param {Object} data - { activities, recipesBySkill, locations }
 * @returns {Array<Object>} candidate target objects
 */
function collectCandidates(rawName, { activities = [], recipesBySkill = {}, locations = [] }) {
    const norm = normalize(rawName);
    const candidates = [];

    // --- 1) TRAVEL (check first) ---
    const travelMatch = TRAVEL_RE.exec(rawName.trim());
    if (travelMatch) {
        const startRaw = normalize(travelMatch[1]);
        const endRaw = normalize(travelMatch[2]);

        const flatLocations = [];
        for (const region of locations) {
            if (region.locations) {
                for (const loc of region.locations) {
                    flatLocations.push(loc);
                }
            }
        }

        const resolveLocation = (query) => {
            const q = normalize(query);
            for (const loc of flatLocations) {
                if (pluralMatch(normalize(loc.name), q)) return loc;
            }
            return null;
        };

        const startLoc = resolveLocation(startRaw);
        const endLoc = resolveLocation(endRaw);

        // Travel target is valid ONLY if BOTH sides resolve to a known location.
        if (startLoc && endLoc) {
            candidates.push({
                type: 'travel',
                travelStart: startLoc.id,
                travelEnd: endLoc.id,
                label: `Travel: ${startLoc.name} → ${endLoc.name}`
            });
        }
    }

    // --- 2) RECIPE (exclude scrap) ---
    for (const skill of Object.keys(recipesBySkill)) {
        const recipes = recipesBySkill[skill];
        if (!Array.isArray(recipes)) continue;

        for (const recipe of recipes) {
            if (recipe.id && recipe.id.endsWith('_scrap')) continue;
            if (recipe.name && /scrap/i.test(recipe.name)) continue;

            const recipeOutputNorm = recipe.output_item_name ? normalize(recipe.output_item_name) : '';
            const recipeNameNorm = recipe.name ? normalize(recipe.name) : '';

            if ((recipeOutputNorm && pluralMatch(recipeOutputNorm, norm)) ||
                (recipeNameNorm && pluralMatch(recipeNameNorm, norm))) {
                candidates.push({
                    type: 'recipe',
                    recipeId: recipe.id,
                    label: recipe.name || recipe.output_item_name
                });
            }
        }
    }

    // --- 3) ACTIVITY ---
    for (const activity of activities) {
        if (pluralMatch(normalize(activity.name), norm)) {
            candidates.push({
                type: 'activity',
                activityId: activity.id,
                label: activity.name
            });
        }
    }

    return candidates;
}

/**
 * Resolve a gear-set name to a single unambiguous target.
 *
 * Tries the full name first; if that yields no single match, retries with the
 * auto-generated optimization-save suffix stripped (so
 * "Cut a birch plank - 2026-07-02 20:56 [Steps/Target Item > ...]" matches the
 * "Cut a birch plank" recipe). Single-match rule applies to whichever pass is
 * used: 0 or >1 candidates -> null.
 *
 * @param {string} name - The gear set name
 * @param {Object} data
 * @param {Array<{id:string, name:string}>} data.activities
 * @param {Object<string, Array<{id:string, name:string, output_item_name:string}>>} data.recipesBySkill
 * @param {Array<{id:string, name:string, locations:Array<{id:string, name:string}>}>} data.locations
 * @param {Object} [opts]
 * @param {boolean} [opts.quiet] - Suppress the per-call diagnostic console logging.
 *   The "sort matching gear sets first" feature resolves EVERY saved set on each
 *   dropdown render; without this the console would flood with one block per set.
 * @returns {{type:string, activityId?:string, recipeId?:string, travelStart?:string, travelEnd?:string, label:string}|null}
 */
export function resolveGearsetTarget(name, data = {}, opts = {}) {
    if (!name || typeof name !== 'string') return null;

    // Targeted diagnostic logging (2026-08-19): surface the raw name, the
    // stripped base, and per-pass candidate labels so we can see WHY a set does
    // or doesn't resolve directly from the browser console. Guarded so it can be
    // silenced with `window.__gsSuggestDebug = false`, and per-call with
    // `opts.quiet` (used by the bulk "sort matching first" path).
    const _dbg = !opts.quiet && ((typeof window === 'undefined') || (window.__gsSuggestDebug !== false));

    const candidates = collectCandidates(name, data);
    if (_dbg) {
        console.log('[gs-suggest:resolve] full-name pass', {
            name,
            candidateCount: candidates.length,
            candidates: candidates.map(c => `${c.type}:${c.label}`)
        });
    }
    if (candidates.length === 1) {
        return candidates[0];
    }

    // Optimization-save names carry a " - <timestamp> [<metric>] (N)" suffix.
    // Retry against the leading activity/recipe portion.
    const base = stripAutoGenSuffix(name);
    if (base && normalize(base) !== normalize(name)) {
        const baseCandidates = collectCandidates(base, data);
        if (_dbg) {
            console.log('[gs-suggest:resolve] stripped-base pass', {
                base,
                candidateCount: baseCandidates.length,
                candidates: baseCandidates.map(c => `${c.type}:${c.label}`)
            });
        }
        if (baseCandidates.length === 1) {
            return baseCandidates[0];
        }
    } else if (_dbg) {
        console.log('[gs-suggest:resolve] no base-strip retry', {
            base,
            reason: !base ? 'empty base' : 'base === name (nothing stripped)'
        });
    }

    if (_dbg) console.log('[gs-suggest:resolve] -> null (0 or >1 candidates in every pass)');
    return null;
}

/**
 * Does a resolved gear-set target refer to the same thing the user currently has
 * selected in Column 3? Pure comparison used by the "sort matching gear sets
 * first" feature to decide which saved sets to float to the top / highlight.
 *
 * A selection is only considered present (and therefore matchable) when the
 * relevant field(s) are set — a travel target needs BOTH endpoints. This mirrors
 * the equality checks the reverse gear-set-suggestion path uses in
 * GearSetManager._evaluateSuggestion.
 *
 * @param {{type:string, activityId?:string, recipeId?:string, travelStart?:string, travelEnd?:string}|null} target
 *   The resolved target for a saved gear set (from resolveGearsetTarget), or null.
 * @param {{selectedActivity?:string|null, selectedRecipe?:string|null, travelStart?:string|null, travelEnd?:string|null}} selection
 *   The current Column-3 selection (typically store.state.column3).
 * @returns {boolean} True when the target matches the current selection.
 */
export function targetMatchesSelection(target, selection = {}) {
    if (!target) return false;
    if (target.type === 'activity') {
        return !!target.activityId && target.activityId === selection.selectedActivity;
    }
    if (target.type === 'recipe') {
        return !!target.recipeId && target.recipeId === selection.selectedRecipe;
    }
    if (target.type === 'travel') {
        return !!target.travelStart && !!target.travelEnd &&
            target.travelStart === selection.travelStart &&
            target.travelEnd === selection.travelEnd;
    }
    return false;
}

/**
 * The Column-3 pseudo-activity id that means "traveling". When it is the
 * selected activity, Column 3 shows the travel start/end dropdowns and
 * column3.travelStart/travelEnd describe the active route.
 */
export const TRAVELING_ACTIVITY_ID = 'traveling';

/**
 * Build a normalized "current selection" for matching from raw column3 state.
 *
 * Column 3 selection is mutually exclusive (activity XOR recipe XOR travel), but
 * the raw state does NOT clear travelStart/travelEnd when you switch to a normal
 * activity or recipe — they linger from the last travel. Comparing a saved
 * travel gear set directly against those stale fields makes travel sets appear to
 * "match" under every activity (bug, 2026-08-21). So travel is only the current
 * selection when the traveling pseudo-activity is active; otherwise its route
 * fields are dropped. Likewise, when traveling, the activity field is cleared so
 * a normal-activity target can't match the 'traveling' sentinel.
 *
 * @param {{selectedActivity?:string|null, selectedRecipe?:string|null, travelStart?:string|null, travelEnd?:string|null}} column3
 * @returns {{selectedActivity:string|null, selectedRecipe:string|null, travelStart:string|null, travelEnd:string|null}}
 */
export function buildMatchSelection(column3 = {}) {
    const isTravel = column3.selectedActivity === TRAVELING_ACTIVITY_ID;
    return {
        selectedActivity: isTravel ? null : (column3.selectedActivity || null),
        selectedRecipe: column3.selectedRecipe || null,
        travelStart: isTravel ? (column3.travelStart || null) : null,
        travelEnd: isTravel ? (column3.travelEnd || null) : null,
    };
}
