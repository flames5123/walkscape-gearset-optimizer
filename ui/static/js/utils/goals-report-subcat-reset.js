/**
 * goals-report-subcat-reset.js
 *
 * Pure (DOM-free) helpers for the per-subcategory Reset feature on the
 * Optimized Goals Report. The report groups results under each top-level
 * section into subgroups (skill / chest / new-item kind / target-item group /
 * target item). Each subgroup header gets a small "Reset" button that clears
 * ONLY that subgroup's saved results so it recomputes fresh on the next run —
 * the finer-grained sibling of the section-level "Emergency reset".
 *
 * These helpers translate a subgroup's DOM identity into a reset SCOPE
 * ({subcategory, leaf?}) that the backend understands, and answer "does this
 * displayed row belong to that scope?" so the page can drop just the reset
 * rows from its in-memory results without a refetch. Keeping the mapping pure
 * lets it be unit-tested and guarantees the client-side row match stays in
 * lock-step with the server-side delete in
 * database.reset_stats_report_subcategory().
 *
 * Column mapping (must match the worker's write path + the DB reset method):
 *   xp / coins / new_items -> subgroup key lives in gearsets.skill_name
 *   chests / chests_recipes -> gearsets.chest_name (normalized to a slug)
 *   target_items -> gearsets.skill_name = group_slug, gearsets.chest_name =
 *                   item_slug (the item leaf)
 * The stale-detector store (stats_report_results) keys these as
 *   (category, subcategory[, source_name=leaf]).
 */

/**
 * Normalize a chest display name ("Mining chest") to its stored subcategory
 * key ("mining_chest") — lowercased, spaces collapsed to underscores. Matches
 * _derive_subcategory() in stats_report_worker.py for chests/chests_recipes.
 */
export function chestSubcategory(chestName) {
    return String(chestName || '').toLowerCase().replace(/\s+/g, '_');
}

/**
 * Parse a target-item skill-group id ("<groupSlug>__<itemSlug>", built by
 * _renderTargetItemSubGroup) into a reset scope {subcategory, leaf}. Returns
 * null when the id isn't in the composite form.
 */
export function targetItemScope(skillGroupId) {
    const s = String(skillGroupId || '');
    const idx = s.indexOf('__');
    if (idx <= 0) return null;
    return {
        subcategory: s.slice(0, idx).toLowerCase(),
        leaf: s.slice(idx + 2).toLowerCase(),
    };
}

/**
 * Does a displayed goals-report row (a stats_report_gearsets row: has
 * skill_name / chest_name) belong to the given reset scope? Mirrors the
 * backend's gearsets match in reset_stats_report_subcategory EXACTLY so the
 * client-side in-memory drop removes precisely the rows the server deleted.
 *
 * @param {string} category   section key
 * @param {Object} row        displayed row ({skill_name, chest_name, ...})
 * @param {Object} scope      {subcategory, leaf?}
 * @returns {boolean}
 */
export function rowMatchesResetScope(category, row, scope) {
    if (!row || !scope || !scope.subcategory) return false;
    const sub = String(scope.subcategory).toLowerCase();
    const leaf = scope.leaf ? String(scope.leaf).toLowerCase() : null;
    if (category === 'chests' || category === 'chests_recipes') {
        return chestSubcategory(row.chest_name) === sub;
    }
    if (category === 'target_items') {
        if (String(row.skill_name || '').toLowerCase() !== sub) return false;
        if (leaf === null) return true;  // whole-group reset
        return String(row.chest_name || '').toLowerCase() === leaf;
    }
    // xp / coins / new_items -> subgroup key is the skill_name column
    return String(row.skill_name || '').toLowerCase() === sub;
}
