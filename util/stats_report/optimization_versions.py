"""Per-category optimization version constants.

Bump the integer for a category WHEN AND ONLY WHEN that category's
optimizer code change can produce a different output for the same
character state. Refactors that don't change output do NOT bump the
version.

Same convention as the travel optimizer's versioning model.

When a row's stored `optimization_version` is less than the current
constant, stale-check flags it as `version_bump` stale.

History (newest first):
  - 2026-09-01 (target_items v4): force one-time re-optimization of all stored
    target_items rows to clear stuck red (!) badges (bug report 8990f0e4).
    Root cause: the per-scope effective-owned dominance_bitmap stored at
    optimize time was computed against a broader owned-item set than the badge
    later recomputes (compute_target_items_stale_groups) against the current
    snapshot — the stored bitmaps referenced gear (e.g. adoring_fan_statue,
    the adventuring set) the current character no longer owns, so the
    stored-vs-recomputed bitmap comparison never matched and every "Fastest
    Target Items" scope was flagged stale forever, surviving re-runs. The
    current code is self-consistent (a fresh rebuild produces write-path signals
    the badge recomputes identically, 0 divergences across all scopes), so
    bumping 3->4 invalidates every pre-existing row via the version_bump path
    and forces a clean re-optimize that stores current-code bitmaps; the badge
    then compares equal and the (!) clears. No stale-detection logic change —
    the sanctioned cache-invalidation knob for a stored-signal drift.
  - 2026-08-13 (target_items v3): target_items ("Fastest Target Items") joins
    stale detection. It previously bypassed the stale filter entirely and
    re-ran EVERY (item x activity) job on every Optimize, and its result rows
    stored an empty dominance_bitmap (b'') + empty metric_inputs_hash
    ("gear-independent, never compared"). The worker now (a) stores the real
    per-scope bitmap -- the activity's primary-skill + first-accessible-location
    effective-owned maximal set, same as xp/coins/chests -- plus a metric hash,
    and (b) filters target_items jobs to only newly-applicable / version-bumped /
    gear-or-input-changed scopes (built jobs are the source of truth for the
    applicable set, so there is no enumerate/build key divergence). Bumping 2->3
    forces the one-time recompute of all pre-existing rows (written at v2 with an
    empty bitmap) so they gain a real bitmap and participate in change detection.
  - 2026-08-02 (chests_recipes v32): crafting now obeys the 10-step-per-action
    floor (bug c61d7623). calculate_crafting_metrics was flooring craft steps at
    1 while the frontend, crafting tree, and activities all floor at 10. On
    high step-reduction gearsets the goals report "Recipes for Chests" therefore
    under-counted steps ~5x vs the activity view (mud pie: 2 steps/craft ->
    ~110 steps/chest instead of 10 steps/craft -> 550). Both the displayed metric
    (steps_per_chest_recipe) AND the selected gearset can change (the recipe exact
    adapter's step_floor moved 1 -> 10, so the engine no longer over-credits
    step-reduction gear), so bump to recompute the rows.
  - 2026-07-31 (xp v13, coins v14, chests v12, chests_recipes v31, new_items v13):
    bug feaa0b46 FOLLOW-UP — the prior fix added allow_occupied_tier3_swap to
    local_search_refine's dumb-upgrade and the recipe paths, but the goals
    report runs in FAST mode, which SKIPS local_search_refine and uses the
    worker's own activity dumb-fill (run_optimizer_for_job). That call did not
    opt in, so occupied rings were never upgraded and collectible rows still
    kept a Gold jade ring instead of the strictly-dominant Collection ring.
    Fix: pass allow_occupied_tier3_swap=True on the worker's activity dumb-fill
    too. Verified in fast mode on the reporting session.
  - 2026-07-31 (xp v12, coins v13, chests v11, chests_recipes v30, new_items v12):
    bug feaa0b46 — the dumb-upgrade pass now allows a tier-3 (inventory_space)
    strict improvement to trigger a swap on an OCCUPIED gear/ring slot (not just
    fill an empty one) for the goals-report callers (activity / recipe / stats
    worker), via allow_occupied_tier3_swap=True. The never-worse check still runs
    first, so the swap is always a strict Pareto improvement. Fixes the
    "Fastest new collectible" optimizer keeping an owned Gold jade ring over the
    strictly-dominant Collection ring (equal find_collectibles + chest_finding,
    PLUS fine_material_finding + inventory_space). Travel is unchanged (it does
    not opt in, so inventory_space stays last-ditch on routes).
  - 2026-07-30 (chests_recipes v29): each service-less region ALTERNATIVE now
    carries a concrete location id (region_location_id) so equipping an alt
    region selects a real location in that region in col-3, instead of the
    region name (which isn't a location).
  - 2026-07-30 (chests_recipes v28): the Alternative Service Locations for
    service-less recipes now split tied regions into one entry PER region (each
    with its own icon), instead of joining them onto one line ("Jarvonia or
    Grand Duchy of Trellin-Erdwise or Wallisia"). Mirrors the primary
    region_lines split.
  - 2026-07-30 (chests_recipes v27): service-less region recipes now populate
    region_location_id (was empty for every one because best_loc had no .id) by
    slugifying the best location name as a fallback, so region-recipe Equip can
    select a concrete location in the chosen region instead of leaving it blank.
  - 2026-07-30 (xp v11, coins v12, chests v10, new_items v11): the ACTIVITY
    dumb-fill now gets the FULL owned pet pool instead of the skill-filtered
    one. The pet skill filter drops pets whose only relevant stat is global
    inventory_space (e.g. Reindeer on a fishing activity, which is a gathering
    skill where Camel's gathering-scoped stats survive), so the fill never saw
    the better inventory pet and left the optimizer's Camel (+1) in place over
    Reindeer (+3). The never-worse dominance keeps it safe. Matches the recipe
    path (which already passes the full pool). Bump activity categories.
  - 2026-07-30 (xp v10, coins v11): the activity multi-location pass (best
    location + Alternative Locations) now also runs for xp and coins, not just
    chests/new_items. The primary row now scores at the BEST location (highest
    xp/step or coins) instead of the first accessible one, and alternative
    locations are surfaced. Sort is direction-aware (xp/coins higher-is-better).
    Primary metric_value can change, so bump xp + coins to recompute.
  - 2026-07-30 (chests_recipes v26): the Alternative Service Locations now
    split each same-gearset alt group by SERVICE TYPE. Different service types
    can share the identical gearset+metric (e.g. Alight Kitchen @ Azurazera +
    Basic Kitchen @ 8 locations; Sawmill of Barbantok @ Barbantok + Basic
    Sawmill @ Kallaheim), but the alt entry labeled them all with the first
    service's name ("Alight Kitchen (9 locs)", "Sawmill of Barbantok (Barbantok
    or Kallaheim)"). Now emits one alt entry per distinct service type with its
    own icon + locations. Display-grouping change to service_alternatives, so
    bump to recompute the rows.
  - 2026-07-30 (xp v9, coins v10, chests v9, chests_recipes v25, new_items v10):
    the pet empty-slot fill now also UPGRADES an occupied pet slot to a
    never-worse, strictly-better pet. The exact optimizer had placed a
    metric-neutral Camel (+1 inventory) over a strictly-better Reindeer (+3)
    and the fill only touched EMPTY slots, so the worse pet stuck. Gearset
    output changes for rows that gain/upgrade a pet (metric unchanged), so
    bump all 5 to recompute rows already stored under the prior versions.
  - 2026-07-29 (xp v8, coins v9, chests v8, chests_recipes v24, new_items v9):
    the shared dumb-upgrade empty-slot fill now also fills the PET slot. The
    exact optimizer scores pets on the metric only, so a metric-neutral pet
    (e.g. Reindeer's global +inventory_space on a crafting recipe) ties with
    EMPTY and empty wins -- the pet slot was left empty even when a free
    inventory pet was owned. The pass now fills an EMPTY pet slot from the
    owned pet pool using the same never-worse dominance rule (inventory_space
    may trigger since the slot is empty; any pet that lowers a stat for the
    skill is rejected; an occupied pet slot is never replaced). Gearset output
    changes for rows that gain a pet (metric unchanged), so bump all 5.
  - 2026-07-28 (xp v7, coins v8, chests v7, new_items v8): the goals-report
    ACTIVITY exact/greedy path now runs the shared dumb-upgrade pass too, filling
    any EMPTY slot with a metric-neutral utility item (never-worse). Matches the
    recipe path (v23) and the greedy calculator so the whole goals report fills
    empties consistently. Gearset output changes (metric unchanged), so bump.
  - 2026-07-28 (chests_recipes v23): the recipe exact+refine path now runs the
    shared dumb-upgrade pass at the end, filling any slot left EMPTY with a
    metric-neutral utility item (inventory space, keyword/find bonuses) the way
    the greedy calculator already did. Never-worse by construction (the pass
    rejects any candidate that lowers a stat). Fills e.g. an empty back slot
    with a backpack; leaves primary/secondary empty when no beneficial item
    exists. Gearset output changes (metric unchanged), so bump to recompute.
  - 2026-07-28 (chests_recipes v22): the recipe exact solve now folds the
    SERVICE's stats into the engine baseline. base_stats arrived with RAW keys
    (work_efficiency/steps_add/chest_finding) but the engine looked them up by
    AXIS keys (W/S_add/A_coins), so every service stat was silently dropped.
    On services with non-zero stats (e.g. Cursed Sawmill: work_efficiency -0.1,
    steps_add +5) this inflated below-cap gearsets (proper set) over higher-WE
    skill gear, mis-ranking recipes like spectral hunting bow (10724 vs the true
    10540). Folding base_stats through _vec (raw->axis + find->A_coins) fixes it.
  - 2026-07-27 (chests_recipes v21): the recipe exact path now enforces the
    SERVICE's keyword requirements (e.g. underwater loom -> 3x diving gear). The
    _RecipeExactAdapter passed only the RECIPE's requirements, not the service's,
    so the exact engine never saw the diving-gear constraint; on characters where
    non-diving gear (e.g. the proper-gear set) out-scored the diving set, the
    engine returned an INVALID gearset with 0 diving gear that can't be crafted
    at that service (bug: Tailor a kelp diving mask @ underwater loom). Fix:
    (1) merge the service's keyword_counts into the adapter's requirements so the
    engine enforces them as hard constraints; (2) enforce them in the refinement's
    _is_valid so best-improvement can't drop below the requirement. Verified 0
    service-requirement violations across 1387 recipe x service solves.

  - 2026-07-27 (chests_recipes v20): the recipe real-metric refinement is now a
    BEST-IMPROVEMENT hill-climb (apply the single globally-best swap per pass)
    instead of first-improvement-per-slot. The per-slot climb was order-
    dependent: from the engine seed (Upcycle trash = circlet+pocketwatch) it
    greedily swapped the head first, which then made the pocketwatch->screwdriver
    swap look worse and stalled at a suboptimal gearset (1809), never selecting
    the screwdriver. Best-improvement takes the larger pocketwatch->screwdriver
    swap first and lands in the correct basin (1809 -> 1767, screwdriver + circlet
    now selected). The exact engine's linear-fractional proxy still mis-ranks
    screwdriver vs pocketwatch at the WE cap (it's a proxy, not the raw metric),
    but the raw-metric best-improvement refinement now recovers the true optimum.
    0 dup/invalid gearsets across 261 recipes, ~0.34s/recipe. Bumping re-runs rows.

  - 2026-07-27 (chests_recipes v19): make the recipe-chest exact optimizer
    truly exact (like activities). Three engine fixes eliminate the residual
    divergence from the real crafting metric: (1) pool_frontier Pareto dominance
    now clamps W at kappa - WE_level, preventing high-W tool bundles from
    wrongly dominating cap-equivalent bundles with better secondary stats;
    (2) per-solve STEP_FLOOR (1 for crafting vs 10 for activities) matches
    calculate_crafting_metrics' max(ceil(...),1); (3) complete real-metric local
    search over ALL slots (seeded from the exact engine) to convergence, using
    calculate_craft_metrics as the objective, guaranteeing a real-metric local
    optimum. The old _refine_recipe_tools tool-only hill-climb is deleted.
    Activities are unchanged (STEP_FLOOR stays 10, no we_level_override, no
    step_floor attr). Zero regressions on 261 recipes (Xavlamin). Bumping
    forces re-runs onto the better gearsets.

  - 2026-07-27 (chests_recipes v18): fix the recipe exact solve's innate
    work-efficiency. The shared exact engine credits an ACTIVITY level-WE bonus
    (min(lvl-reqlvl,20)*0.0125), but crafting's innate level-WE is different
    (e.g. Carpentry L62: engine 0.25 vs real 0.125). Over-crediting innate WE
    made WE gear look like it hit the max_efficiency cap sooner, so the engine
    picked DA-heavy gearsets the real crafting metric rates worse (24/261
    recipes off by up to 7.97%). Fix: the recipe adapter now passes the true
    crafting innate WE (aggregate_gearset_stats level + collectibles) into the
    engine via we_level_override; activities are unchanged (they never set it).
    Cuts divergence to 6/261 (<=2.73%); the keyword-safe tool refinement still
    mops up that residual. Bumping re-runs recipe rows onto the better gearsets.

  - 2026-07-27 (chests_recipes v17): the recipe tool refinement now respects
    keyword uniqueness / banned keyword groups. _refine_recipe_tools scored each
    tool slot independently and only skipped a candidate already in another slot
    by tool id -- it never checked that two DIFFERENT tools may not share a
    non-excluded keyword (game rule: at most one item per keyword; banned groups
    are mutually exclusive). Result: Carpentry recipes equipped 3-4 saws at once
    (all share the 'saw' keyword). The exact solve's pool_frontier already
    enforces this, but the refinement pool is unconstrained, so it stacked
    same-keyword tools. Fix gates every candidate swap through
    validate_tool_keywords (the same check gearset_utils/greedy use).
    Reproduced on Xavlamin: 35/35 Carpentry recipes had duplicate-'saw' tool
    sets pre-fix, 0/35 post-fix. Bumping re-runs affected recipe rows.

  - 2026-07-27 (chests_recipes v16): fix duplicate tools from the recipe tool
    refinement. _refine_recipe_tools capped placement at the OWNED quantity of a
    tool, so a tool owned 2+ times (e.g. "Topaz tipped chisel (Great)", qty=2)
    could be equipped in two tool slots at once — the game (and the exact
    optimizer's pool_frontier, `it.id in comp`) allows at most ONE of each tool
    type regardless of how many copies you own. The refinement now enforces tool
    uniqueness (never places a tool cid already in another tool slot). Bug
    d9dc7357 (Trinketry: two gem/topaz tipped chisels). Bumping re-runs affected
    recipe rows to drop the duplicate.

  - 2026-07-27 (chests_recipes v15): service-less recipes now include
    UNDERWATER regions (Syrenthia) as candidate crafting regions. The
    service-less region enumeration blanket-skipped every underwater location
    (`if loc.is_underwater: continue`), and since every Syrenthia crafting spot
    (Vastalume, Kelp Forest, Darktide Trench, Underwater Cave, Casbrant's Grave,
    Elara's Lagoon) is underwater, Syrenthia could never surface as a best-or-alt
    region for a service-less recipe -- even though SERVICE recipes happily
    recommend underwater services (Tidal Workshop @ Vastalume). Region access is
    already gated by `_UNLOCKED_REGIONS` (the same check the service path uses),
    so the underwater skip was redundant and wrong. Also emits a per-alternative
    service_icon (service recipes) / region_icon (service-less) so alt rows show
    the correct badge instead of a location icon slugified from the name.
    Bumping forces service-less recipe rows to re-run so Syrenthia can appear.

  - 2026-07-26 (chests_recipes v14): recipe chest exact + cheap real-metric
    tool refinement. The exact MITM optimizer maximizes a linear rate/step PROXY
    calibrated by probing the recipe adapter. For a CRAFTING recipe that proxy
    can diverge from the real crafting metric (calculate_craft_metrics) at the
    work-efficiency CAP: near the cap a WE/DR tool (Screwdriver) and a steps%
    tool (Flowing pocketwatch) trade off, and the proxy's cap handling ranked
    the steps% tool above the WE/DR one while the real metric ranks them the
    other way (Upcycle trash @ Vastalume: exact 1848 vs real 1713). Both MITM
    and B&B faithfully maximize the (diverging) proxy. Fix: after the exact
    solve, _recipe_solve runs a CHEAP real-metric 1-swap hill-climb over the
    TOOL slots only (~0.2s/service vs greedy's ~2s) — tools carry no diving-gear
    service requirement, so tool swaps are always valid, and that's exactly
    where the divergence lives. Corrects Vastalume 1848->1713, and can beat both
    exact and greedy (Wraithwater 2423->2385). Supersedes the v13 run-both
    approach, which was correct but ~16x slower (ran full greedy per recipe).
    Bumping forces stranded recipe-chest rows to re-run and self-heal.

  - 2026-07-22 (new_items v7, coins v7, chests v6, chests_recipes v12):
    bug feaa0b46. The stats-report worker threads re-applied the character's
    thread-local walkscape_globals (achievement_points / total_skill_level /
    custom_stats) but NOT total_collectibles. That global gates the item
    collection ring's finding/inventory bonuses; left at its default 0 in the
    ThreadPoolExecutor worker, the ring resolved to EMPTY stats, was filtered
    out by has_activity_relevant_stats, and the optimizer picked a strictly
    dominated ring (Great gold jade ring over the collection ring on collectible
    rows). The "regular" optimizer runs in the request thread where the global
    is set, hence the user-visible divergence. Fix re-applies total_collectibles
    in the worker (via the new _reapply_character_thread_local_globals helper).
    This changes the gear picked wherever the collection ring (or any future
    total_collectibles-gated gear) is optimal: new_items (find_collectibles),
    coins + chests + chests_recipes (chest_finding / collectible contributions).
    xp is unaffected — none of the ring's stats change XP/step — so it stays at
    v6. Bumping forces stranded rows to re-run and self-heal without a reset.

  - 2026-07-20 (new_items v6): the July combined-odds feature changed the
    new_items row PAYLOAD format — the worker now writes `best_drop`
    {item_name,item_ref,kind} and `new_items_combined` {kind,count,items[]}
    into metrics_json, and the frontend renders the row title + drop
    popover + expandable per-item list from those fields. That format
    change was never version-bumped, so rows written before it (at the
    then-current v5) are stranded: they sit in stale-detection's seen_keys
    at the CURRENT version with no best_drop/combined metadata — and in the
    worst case a `gear`-subcategory row still carries a COLLECTIBLE item
    (e.g. Shoreline scramble/gear storing "Shiny broken skydisc" instead of
    "Feather boots"). detect_stale_scopes only invalidates on version bump
    or character-state change, so an incremental "run optimization" never
    re-runs these scopes — the correct item never appears and the kind
    falsely renders "All accessible gear obtained." Only a full RESET
    (cache wipe) fixed it. Bug: Feather boots from Shoreline scramble
    missing until reset (2026-07-20). Bumping forces a re-run that
    overwrites every stranded new_items row with correct kind/metric_name +
    best_drop/combined metadata, so the list self-heals on the next
    optimize WITHOUT a reset.
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
    "xp": 13,
    "coins": 14,
    "chests": 12,
    "chests_recipes": 32,
    "new_items": 13,
    "target_items": 4,
}


def get_version(category: str) -> int:
    """Return the current version constant for a category."""
    return OPTIMIZATION_VERSIONS.get(category, 1)
