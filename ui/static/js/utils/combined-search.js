/**
 * combined-search.js
 *
 * Pure helpers for the "Combine activity & recipe search" Misc UI setting.
 *
 * When the setting is on, the main optimizer's Column 3 replaces its two
 * separate Activity and Recipe dropdowns with a single dropdown that searches
 * across BOTH at once. These helpers do the data plumbing — merging the two
 * `by_skill` payloads into one skill-keyed map of typed entries, filtering by
 * search text, and sorting — with no DOM/jQuery/state dependencies so they can
 * be unit-tested in isolation.
 *
 * This does NOT touch the crafting tree, which owns its own decoupled recipe
 * dropdown (RecipeSelectorDropdown with decoupleColumn3:true).
 */

/**
 * Normalize a single activity record into a combined entry.
 * Activities carry their level under requirements.skill_requirements[primary_skill].
 * @param {Object} activity
 * @returns {Object} { type:'activity', id, name, level, icon_path, skill, primary_skill }
 */
export function normalizeActivity(activity) {
    const primarySkill = activity.primary_skill;
    const level = activity.requirements?.skill_requirements?.[primarySkill] || 1;
    return {
        type: 'activity',
        id: activity.id,
        name: activity.name || '',
        level,
        icon_path: activity.icon_path,
        skill: primarySkill,
        primary_skill: primarySkill,
    };
}

/**
 * Normalize a single recipe record into a combined entry.
 * Recipes carry their level directly as `level` and their skill as `skill`.
 * @param {Object} recipe
 * @returns {Object} { type:'recipe', id, name, level, icon_path, skill }
 */
export function normalizeRecipe(recipe) {
    return {
        type: 'recipe',
        id: recipe.id,
        name: recipe.name || '',
        level: recipe.level || 1,
        icon_path: recipe.icon_path,
        skill: recipe.skill,
    };
}

/**
 * Sort a list of combined entries in place-safe (returns a new array).
 * @param {Array} entries
 * @param {boolean} orderByLevel - true: by level then name; false: alphabetical by name
 * @returns {Array}
 */
export function sortCombinedEntries(entries, orderByLevel) {
    const copy = [...entries];
    if (orderByLevel) {
        copy.sort((a, b) => {
            const lvlA = a.level || 1;
            const lvlB = b.level || 1;
            if (lvlA !== lvlB) return lvlA - lvlB;
            return a.name.localeCompare(b.name);
        });
    } else {
        copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
}

/**
 * Parse the combined-dropdown search box query into an optional type filter
 * plus free-text name terms.
 *
 * The user can prefix (or embed) a type keyword to restrict results:
 *   - "recipe"        -> all recipes
 *   - "recipe stew"   -> recipes whose name contains "stew"
 *   - "activity min copper" -> activities whose name contains BOTH "min" and "copper"
 *   - "stew"          -> anything whose name contains "stew" (no type filter)
 *
 * The FIRST standalone `activity`/`activities`/`recipe`/`recipes` token is
 * consumed as the type filter; all remaining whitespace-separated tokens are
 * name terms that must ALL be present (order-independent). Matching the type
 * keyword only as a standalone token means a name that merely contains the
 * substring (e.g. a hypothetical "Recipe Book" item) is still searchable via
 * the other terms.
 *
 * @param {string} searchText
 * @returns {{ typeFilter: ('activity'|'recipe'|null), terms: string[] }}
 */
export function parseSearchQuery(searchText) {
    const raw = (searchText || '').trim().toLowerCase();
    if (!raw) return { typeFilter: null, terms: [] };

    let typeFilter = null;
    const terms = [];
    for (const tok of raw.split(/\s+/)) {
        if (typeFilter === null && (tok === 'activity' || tok === 'activities')) {
            typeFilter = 'activity';
            continue;
        }
        if (typeFilter === null && (tok === 'recipe' || tok === 'recipes')) {
            typeFilter = 'recipe';
            continue;
        }
        terms.push(tok);
    }
    return { typeFilter, terms };
}

/**
 * Build the merged, filtered, sorted skill-keyed map used by the combined
 * dropdown. Skills present in either activities or recipes appear as keys;
 * each value is a flat list of typed entries (activities and recipes together)
 * for that skill.
 *
 * @param {Object|null} activitiesData - payload from /api/activities ({ by_skill })
 * @param {Object|null} recipesData - payload from /api/recipes ({ by_skill })
 * @param {Object} [options]
 * @param {string} [options.searchText=''] - case-insensitive filter (supports a leading/embedded
 *   `activity`/`recipe` type keyword plus free-text name terms; see parseSearchQuery)
 * @param {boolean} [options.orderByLevel=true] - sort mode within each skill
 * @returns {Object} { [skill: string]: Array<combinedEntry> } — only skills with at least one match
 */
export function buildCombinedCategories(activitiesData, recipesData, options = {}) {
    const { typeFilter, terms } = parseSearchQuery(options.searchText);
    const orderByLevel = options.orderByLevel !== false; // default true

    const activitiesBySkill = activitiesData?.by_skill || {};
    const recipesBySkill = recipesData?.by_skill || {};

    // Accumulate entries per skill.
    const merged = {};

    const matches = (entry) => {
        if (typeFilter && entry.type !== typeFilter) return false;
        if (terms.length) {
            const name = entry.name.toLowerCase();
            // All free-text terms must be present (order-independent AND match).
            return terms.every(t => name.includes(t));
        }
        return true;
    };

    const push = (skill, entry) => {
        if (!skill) return;
        if (!matches(entry)) return;
        if (!merged[skill]) merged[skill] = [];
        merged[skill].push(entry);
    };

    for (const [skill, activities] of Object.entries(activitiesBySkill)) {
        for (const activity of activities) {
            push(skill, normalizeActivity(activity));
        }
    }
    for (const [skill, recipes] of Object.entries(recipesBySkill)) {
        for (const recipe of recipes) {
            push(skill, normalizeRecipe(recipe));
        }
    }

    // Sort entries within each skill and drop empty skills.
    const result = {};
    for (const [skill, entries] of Object.entries(merged)) {
        if (entries.length === 0) continue;
        result[skill] = sortCombinedEntries(entries, orderByLevel);
    }
    return result;
}

/**
 * Look up a single combined entry (activity or recipe) by its id + type.
 * Used to resolve the current selection into a display label.
 * @param {Object|null} activitiesData
 * @param {Object|null} recipesData
 * @param {string} type - 'activity' | 'recipe'
 * @param {string} id
 * @returns {Object|null} normalized combined entry or null
 */
export function findCombinedEntry(activitiesData, recipesData, type, id) {
    if (!id) return null;
    if (type === 'activity') {
        for (const activities of Object.values(activitiesData?.by_skill || {})) {
            const found = activities.find(a => a.id === id);
            if (found) return normalizeActivity(found);
        }
    } else if (type === 'recipe') {
        for (const recipes of Object.values(recipesData?.by_skill || {})) {
            const found = recipes.find(r => r.id === id);
            if (found) return normalizeRecipe(found);
        }
    }
    return null;
}
