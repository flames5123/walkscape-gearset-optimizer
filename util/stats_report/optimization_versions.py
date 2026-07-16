"""Per-category optimization version constants.

Bump the integer for a category WHEN AND ONLY WHEN that category's
optimizer code change can produce a different output for the same
character state. Refactors that don't change output do NOT bump the
version.

Same convention as the travel optimizer's versioning model.

When a row's stored `optimization_version` is less than the current
constant, stale-check flags it as `version_bump` stale.

History (newest first):
  - 2026-06-19 (chests_recipes v11): chests_recipes stale scope location
    switched from hard-coded "global" to the real per-character service
    location (representative_recipe_service_location). The dominance_bitmap
    is now computed at the actual crafting location, so location-specific
    crafting gear is included in the maximal set (previously dropped at
    "global"). Different scope location -> different bitmap -> existing rows
    re-run once. See .kiro/RECIPE_LOCATION_STALE_KEY.md.
  - 2026-06-16 (chests_recipes v10): recipe service resolution
    (_resolve_services_for_recipe / _recipe_has_unlocked_service) now
    filters service candidates by region accessibility
    (_service_location_accessible), mirroring the activity job-builders.
    ServiceInstance.is_unlocked() only checks skill/reputation/coins/
    keyword and deliberately ignores region gating, so a service in a
    locked region (e.g. Heatstroke Metalworks in Myriadian Arc, gated by
    the Charter of the Drowned) was recommended to characters who can't
    reach it. With the filter the worker now picks the best ACCESSIBLE
    service, which can change the stored gearset/metric/service for
    affected recipes — bump forces a re-run so those rows drop the
    inaccessible recommendation. applicable_sources got the same filter
    so stale detection stays consistent.
  - 2026-06-05 (xp v6, coins v6, chests v5, chests_recipes v9,
    new_items v5): worker now computes slot alternatives in the
    optimizer's exact environment (compute_slot_alternatives, with the
    real final_gearset + all module globals intact) and stores them in
    metrics_json as `_slot_alternatives` / `_slot_locked_alternatives`.
    The frontend reads these directly for the unedited gearset instead
    of the on-demand /slot-alternatives endpoint, which could not
    reproduce the worker environment from the stored export (export
    omits pet/consumable; several globals unset) and therefore scored a
    divergent baseline (e.g. 4494 vs the row's 2828 on Horseshoe making
    / Smithing chest), surfacing false-positive upgrades. Same gearset,
    same primary metric — just adds the alternatives map. Existing rows
    lack it; bumping forces a re-run that populates it.
  - 2026-06-03 (chests v4, chests_recipes v8): worker now writes
    `chests_per_chest` (per-chest-type steps map) and
    `steps_per_any_chest` (harmonic aggregate) to metrics_breakdown
    /metrics_json. Frontend uses these to render a "Total: X
    steps/all chests ⓘ" line on rows whose activity/recipe drops
    2+ chest types (e.g. via treasure_grabber gear adding Treasure
    chest drops on top of the activity's native chest). Existing
    rows lack these fields; bumping forces a re-run that populates
    them. Same gearset, same primary metric — just adds the
    per-chest map.
  - 2026-06-02 (xp v5): build_xp_jobs restructured to iterate by
    activity instead of by selected_skill. Previously a multi-skill
    activity (e.g. Cave diving) only emitted Foraging+Agility jobs if
    the user had Foraging AND Agility selected in the WTO — selecting
    just Mining silently dropped the secondary rows, so Cave diving
    appeared only under Mining. Now: an activity is included iff ANY
    of its granted XP skills (primary + secondary_xp keys) is in
    selected_skills, and once included, jobs emit for ALL granted
    skills. Bumping forces a re-run that writes the secondary rows
    that were missing on prior selection-narrowed runs.
  - 2026-06-02 (xp v4): worker now writes one stats_report_gearsets
    row per granted XP skill on multi-skill activities (e.g. Cave
    diving grants Mining + Foraging + Agility XP — 3 rows now,
    1 row before). Same gearset_export shared across rows; metric_value
    differs per skill (xp_per_step_by_skill[skill]). Existing v3 rows
    only carry the primary skill row, so re-run picks up the
    secondary-skill rows. enumerate_applicable_sources now emits xp
    scopes per granted skill so stale detection matches.
  - 2026-06-02 (chests_recipes v7): when multiple unlocked services
    validate the recipe (typical for Carpentry/Smithing recipes that
    can be crafted at any service of the right tier), the worker now
    iterates them and picks the lowest steps_per_chest_recipe instead
    of locking in the alphabetically-first match. User-reported
    example: Fletch copper arrows showed 2,375 steps at Basic Sawmill
    (Everhaven) but the user had Saw-in-Half Mill (Halfling
    Campgrounds) unlocked which gave 2,210 — the location-scoped
    gear bonuses at Halfling Campgrounds beat the alphabetic default.
  - 2026-06-02 (chests_recipes v6): serviceless recipes now run a
    location-iteration loop in run_recipe_optimizer_for_job — same
    algorithm the crafting tree uses for "Best (auto)" location pick.
    The optimizer scores each accessible region's gear bonuses and
    picks the best, exposed via service_location in metrics_json.
    Pre-bump rows were scored against SELECTED_LOCATION=None (no
    region-scoped gear) and have no chosen-location field, so they
    must re-run to pick up both the (slightly different) metric and
    the location pill. Service-backed recipe rows are unaffected by
    this code path but get re-run anyway.
  - 2026-05-29 (chests_recipes v4): worker
    build_chests_recipes_jobs._recipe_has_unlocked_service silently
    treated service='None' (string) as a real service that needs
    unlocking. The truthy string fell through to the SERVICES_BY_NAME
    iteration, found no matching service, and skipped the recipe — so
    every basic crafting/carpentry recipe (Make a basic hatchet, Craft
    a bag of rocks, Spin flax into twine, etc.) had ZERO chests_recipes
    rows written. enumerate_applicable_sources now correctly enumerates
    them, so without bumping the version those scopes would ghost as
    REASON_NEWLY_UNLOCKED forever. Bumping forces a re-run that writes
    the missing rows. Same fix also lowercased _derive_service to emit
    'NONE' for these recipes (was 'none'), matching applicable_sources.
  - 2026-05-26 (v3): ALL categories v3 — fixed the worker's
    optimize_activity_gearsets path which had been calling
    aggregate_gearset_stats(include_collectibles=False) AND
    get_expected_drop_rate(include_collectibles_from_character=False)
    after the v2 collectible fix. That left collectibles
    UNCOUNTED in worker scores (worker was 191.56 vs column-3 196.2
    for Sea fishing Spear coins). Flipped aggregate to True so
    collectibles are counted exactly once via total_stats.
  - 2026-05-26 (v2): ALL categories v2 — fixed get_expected_drop_rate
    collectible double-count bug. The worker was adding collectibles
    to every aggregated stat (WE/DA/DR/FMF/CF/find_*/etc) on top of
    pre-merged stats from aggregate_gearset_stats. All stored values
    are inflated by the collectibles' contribution to those stats and
    must be re-scored. Affects every stored row in stats_report_results.
  - 2026-05-22: Initial release. All categories at v1.

  - 2026-06-01 (coins v5): activity-side cat:coins/cat:coins_no_chests
    optimizer was silently pruning rings/items whose only edge over a
    rival item was an ItemFindingCategory.* stat. The dominance pruner
    in util/optimization_utils.prune_dominated_items only sees stats in
    `useful_finding_stats`, and `get_useful_finding_stats` did NOT mark
    IF.* relevant for the cat:coins aggregator. Result: e.g. Gold sun
    stone ring (IF.GOLD_PIECES=15) was treated as dominated by Gold
    ruby ring (chest_finding=3, double_rewards=1.5) — both have CF=3
    and IF.GOLD_PIECES is invisible — so sun stone got pruned and the
    optimizer settled on Gold ruby for cat:coins at willow cutting.
    Bug afede899. Fix: get_useful_finding_stats now adds every
    ItemFindingCategory.* stat to useful when target is cat:coins,
    cat:coins_no_chests, or cat:sea_shells (every IF expansion drops
    sellable items / shells and contributes to the aggregate). All
    stored cat:coins gearsets are re-scored.

Future bumps go here, e.g.:
  - 2026-05-31: coins v4, chests_recipes v5, new_items v4 — sea shell
    aggregator (cat:sea_shells) added. drop_rates now carries the
    synthetic 'cat:sea_shells' steps_per_shell value mirroring
    cat:coins. Activity scorer + recipe enrichment expose shell_value
    on every shell-yielding drop. Sessions with cat:sea_shells in
    their priority list need re-optimization to score against the
    new aggregator (which folds in chest contributions and the
    Material.SEA_SHELL_FINE.special_sell ×10 multiplier instead of
    the old _FINE_FOLD_MULTIPLIER branch in
    optimize_activity_gearsets._compute_spr_for_target).
"""

OPTIMIZATION_VERSIONS = {
    "xp": 6,
    "coins": 6,
    "chests": 5,
    "chests_recipes": 11,
    "new_items": 5,
}


def get_version(category: str) -> int:
    """Return the current version constant for a category."""
    return OPTIMIZATION_VERSIONS.get(category, 1)
