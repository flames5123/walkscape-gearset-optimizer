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
 * @param {Object} p.flags                 - {notifyOnComplete, includePets, includeConsumables, usePetAbility, fast}
 * @returns {Object} the ui_config.goalsReportConfig payload
 */
/**
 * Fastest Craft deselections are prefixed chip ids ('gear:rings', 'mat:bar').
 * Drops anything else, e.g. bare category labels saved before the grouped
 * taxonomy, which would otherwise never match a chip.
 */
export function fastestCraftChipIds(values) {
    return (values || []).map(String).filter(v => /^(gear|tools|cons|mat):/.test(v));
}

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
            usePetAbility: !!(p.flags && p.flags.usePetAbility),
            fast: !!(p.flags && p.flags.fast),
            // 2026-09-23 (jwbail): report-local Consumable Options. These were
            // passed in by _persistGoalsReportConfig but NOT serialized here,
            // so they were silently dropped from the session's goalsReportConfig
            // (confirmed via a prod bug-report snapshot whose flags lacked every
            // min-owned field). That broke session-durable persistence of the
            // "ignore < X owned" filter (and the fine / use-hidden sub-options).
            includeFineConsumables: (p.flags && p.flags.includeFineConsumables !== undefined)
                ? !!p.flags.includeFineConsumables : true,
            consumableMinOwnedEnabled: !!(p.flags && p.flags.consumableMinOwnedEnabled),
            consumableMinOwned: (p.flags && Number.isFinite(p.flags.consumableMinOwned))
                ? p.flags.consumableMinOwned : 5,
            consumableMinOwnedOperator: (p.flags && p.flags.consumableMinOwnedOperator === 'lte')
                ? 'lte' : 'lt',
            consumableUseHidden: !!(p.flags && p.flags.consumableUseHidden),
            consumablesCollapsed: !!(p.flags && p.flags.consumablesCollapsed),
            petsCollapsed: !!(p.flags && p.flags.petsCollapsed),
            // Fastest Craft chip-id DESELECTIONS (universe is fetched async,
            // so deselections keep newly-added chips selected).
            fastestCraftDeselected: (p.flags && Array.isArray(p.flags.fastestCraftDeselected))
                ? fastestCraftChipIds(p.flags.fastestCraftDeselected) : [],
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
    for (const k of ['notifyOnComplete', 'includePets', 'includeConsumables', 'usePetAbility', 'fast']) {
        if (typeof f[k] === 'boolean') out.flags[k] = f[k];
    }
    // 2026-09-23 (jwbail): mirror the write side — restore report-local
    // Consumable Options from the session config. The boolean loop above can't
    // cover the numeric threshold or the string operator, so copy them
    // explicitly (same guards _hydrateSelectionsFromSession uses).
    if (typeof f.includeFineConsumables === 'boolean') out.flags.includeFineConsumables = f.includeFineConsumables;
    if (typeof f.consumableMinOwnedEnabled === 'boolean') out.flags.consumableMinOwnedEnabled = f.consumableMinOwnedEnabled;
    if (Number.isFinite(f.consumableMinOwned)) out.flags.consumableMinOwned = f.consumableMinOwned;
    if (f.consumableMinOwnedOperator === 'lt' || f.consumableMinOwnedOperator === 'lte') out.flags.consumableMinOwnedOperator = f.consumableMinOwnedOperator;
    if (typeof f.consumableUseHidden === 'boolean') out.flags.consumableUseHidden = f.consumableUseHidden;
    if (typeof f.consumablesCollapsed === 'boolean') out.flags.consumablesCollapsed = f.consumablesCollapsed;
    if (typeof f.petsCollapsed === 'boolean') out.flags.petsCollapsed = f.petsCollapsed;
    if (Array.isArray(f.fastestCraftDeselected)) out.flags.fastestCraftDeselected = fastestCraftChipIds(f.fastestCraftDeselected);
    return out;
}
