/**
 * goals-report-selection.js
 *
 * Pure (DOM-free, store-free) helpers for persisting the Optimized Goals
 * Report's "What to optimize" selection to the SESSION (server-side
 * ui_config), rather than only the browser's localStorage.
 *
 * Why this module exists
 * ----------------------
 * The goals-report page lets the user pick which optimization categories to
 * run (XP, coins, chests, chest-recipes, new items) plus per-category skill
 * chips, chest chips, and new-item "kind" chips, and a few run flags (notify,
 * include pets/consumables, fast). Previously these lived ONLY in localStorage
 * (per-browser, shared across every session). When the user swapped between
 * debug sessions the boxes never followed the session — they had to re-check
 * them every time. This moves the authoritative copy into the session's
 * ui_config so it (a) follows the session and (b) is copied into snapshot
 * sessions automatically (the snapshot path copies the whole ui_config).
 *
 * Auto-expandable design (deselection semantics)
 * ----------------------------------------------
 * We persist the user's DESELECTIONS (what they turned OFF), not their
 * selections. The selected set is always reconstructed as
 * `all_currently_known − deselected`. That makes the persistence
 * forward-compatible: when we later ship a NEW optimization category (or a new
 * skill / chest / kind within one), it is not present in anyone's saved
 * "deselected" list, so it defaults to SELECTED for every existing session
 * with no migration. "Expand" here means the selection universe expands.
 *
 * The empty-selection case is preserved exactly: if the user turns every chip
 * in a category off, the deselected list equals the full universe, so the
 * reconstructed selected set is empty (not defaulted back to "all").
 */

/** Config schema version, bumped only on incompatible shape changes. */
export const GOALS_REPORT_CONFIG_VERSION = 1;

/** Items present in `all` that are NOT in the `selected` Set (the deselections). */
export function deselectedFrom(all, selected) {
    const sel = selected instanceof Set ? selected : new Set(selected || []);
    return (all || []).filter((x) => !sel.has(x));
}

/** Reconstruct the selected Set = `all` minus `deselected` (auto-includes new items). */
export function selectedFrom(all, deselected) {
    const off = new Set(deselected || []);
    return new Set((all || []).filter((x) => !off.has(x)));
}

/**
 * Build the persisted goals-report config object from the page's current
 * in-memory selection state. All inputs are plain arrays / Sets so this is
 * unit-testable without a DOM or store.
 *
 * @param {Object} p
 * @param {string[]} p.categoryKeys        - all known category keys
 * @param {Set<string>} p.selectedCategories
 * @param {string[]} p.skillChipCategories - category keys that own skill chips
 * @param {string[]} p.allSkillNames
 * @param {Object<string,Set<string>>} p.selectedSkillsByCat
 * @param {string[]} p.chestChipCategories - category keys that own chest chips
 * @param {string[]} p.allChestNames
 * @param {Object<string,Set<string>>} p.selectedChestsByCat
 * @param {string[]} p.allKinds
 * @param {Set<string>} p.selectedKinds
 * @param {Object} p.flags                 - {notifyOnComplete, includePets, includeConsumables, fast}
 * @returns {Object} the ui_config.goalsReportConfig payload
 */
export function buildGoalsReportConfig(p) {
    const cfg = {
        version: GOALS_REPORT_CONFIG_VERSION,
        deselectedCategories: deselectedFrom(p.categoryKeys, p.selectedCategories),
        deselectedSkillsByCat: {},
        deselectedChestsByCat: {},
        deselectedKinds: deselectedFrom(p.allKinds, p.selectedKinds),
        flags: {
            notifyOnComplete: !!(p.flags && p.flags.notifyOnComplete),
            includePets: !!(p.flags && p.flags.includePets),
            includeConsumables: !!(p.flags && p.flags.includeConsumables),
            fast: !!(p.flags && p.flags.fast),
        },
    };
    // Only record skill/chest deselections once the universe is known
    // (SKILL_GROUPS loaded). Writing against an empty universe would
    // spuriously mark everything deselected.
    if (p.allSkillNames && p.allSkillNames.length) {
        for (const cat of p.skillChipCategories || []) {
            const sel = (p.selectedSkillsByCat && p.selectedSkillsByCat[cat]) || null;
            // A category with no materialized set means "all selected" (never
            // touched) -> no deselections.
            cfg.deselectedSkillsByCat[cat] = sel ? deselectedFrom(p.allSkillNames, sel) : [];
        }
    }
    if (p.allChestNames && p.allChestNames.length) {
        for (const cat of p.chestChipCategories || []) {
            const sel = (p.selectedChestsByCat && p.selectedChestsByCat[cat]) || null;
            cfg.deselectedChestsByCat[cat] = sel ? deselectedFrom(p.allChestNames, sel) : [];
        }
    }
    return cfg;
}

/**
 * Reconstruct the page's in-memory selection state from a persisted config.
 * Any category/skill/chest/kind not explicitly deselected in `cfg` is
 * SELECTED (auto-expandable). Returns plain Sets/objects; the caller assigns
 * them onto the page instance.
 *
 * @param {Object} cfg - the stored ui_config.goalsReportConfig (may be partial)
 * @param {Object} u   - the current universe {categoryKeys, skillChipCategories,
 *                       allSkillNames, chestChipCategories, allChestNames, allKinds}
 * @returns {{selectedCategories:Set,selectedSkillsByCat:Object,selectedChestsByCat:Object,selectedKinds:(Set|null),flags:Object}}
 */
export function applyGoalsReportConfig(cfg, u) {
    cfg = cfg || {};
    const out = {
        selectedCategories: selectedFrom(u.categoryKeys, cfg.deselectedCategories),
        selectedSkillsByCat: {},
        selectedChestsByCat: {},
        selectedKinds: null,
        flags: {},
    };
    const dSkills = cfg.deselectedSkillsByCat || {};
    for (const cat of u.skillChipCategories || []) {
        out.selectedSkillsByCat[cat] = selectedFrom(u.allSkillNames, dSkills[cat] || []);
    }
    const dChests = cfg.deselectedChestsByCat || {};
    for (const cat of u.chestChipCategories || []) {
        out.selectedChestsByCat[cat] = selectedFrom(u.allChestNames, dChests[cat] || []);
    }
    if (Array.isArray(cfg.deselectedKinds)) {
        out.selectedKinds = selectedFrom(u.allKinds, cfg.deselectedKinds);
    }
    const f = cfg.flags || {};
    for (const k of ['notifyOnComplete', 'includePets', 'includeConsumables', 'fast']) {
        if (typeof f[k] === 'boolean') out.flags[k] = f[k];
    }
    return out;
}
