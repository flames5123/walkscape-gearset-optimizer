"""applicable_sources — enumerate sources currently applicable for character.

Single source of truth for "what can the character optimize for." Used by
detect_stale_scopes for newly-unlocked detection.
"""

from typing import Set, Tuple

from .normalize import normalize_item_id
from .state_snapshot import CharacterStateSnapshot


def _is_unlocked(item, state: CharacterStateSnapshot) -> bool:
    """Reuse the unlock check from effective_bitmap."""
    from .effective_bitmap import _check_unlock
    return _check_unlock(item, state)


def _activity_applicable(activity, state: CharacterStateSnapshot) -> bool:
    """Check if activity is applicable: skill level + custom_stats gates."""
    # 2026-06-16 (jwbail): the activity's level gate lives in
    # `skill_requirements` ({skill: level}, e.g. Predator fishing -> Fishing 55),
    # NOT in `requirements` (which is a dict of keyword_counts/etc.). Iterating
    # `requirements` as a list of {type:'skill'} dicts found nothing, so a
    # level-locked activity was enumerated as applicable and ghosted as
    # REASON_NEWLY_UNLOCKED (user: "Predator fishing shows under hunting chest
    # but I'm Fishing 50, it needs 55"). Gate on skill_requirements here.
    sr = getattr(activity, "skill_requirements", None) or {}
    if isinstance(sr, dict):
        for skill, lvl in sr.items():
            sk = (skill if isinstance(skill, str) else getattr(skill, "name", "")).lower()
            try:
                need = int(lvl)
            except (TypeError, ValueError):
                need = 0
            if sk and state.skill_levels.get(sk, 1) < need:
                return False

    # Legacy list-form requirements (some sources use type-tagged dicts).
    reqs = getattr(activity, "requirements", None)
    if isinstance(reqs, list):
        for req in reqs:
            if not isinstance(req, dict):
                continue
            rt = req.get("type")
            if rt == "skill":
                skill = (req.get("skill") or "").lower()
                if state.skill_levels.get(skill, 1) < req.get("level", 0):
                    return False
            elif rt == "character_level":
                if state.character_level < req.get("level", 0):
                    return False
    elif isinstance(reqs, dict):
        # 2026-06-16 (jwbail): dict-form requirements ({keyword_counts,
        # reputation, achievement_points, ...}). Gate on reputation and
        # achievement_points to match activity.is_unlocked — without this, a
        # reputation-locked activity (e.g. Merfolk farm foraging needs
        # Syrenthia rep 10) was enumerated as applicable while the worker's
        # is_unlocked correctly skipped it, ghosting it as REASON_NEWLY_UNLOCKED.
        # keyword_counts are NOT checked here: they need an equipped gearset,
        # is_unlocked(no gearset) passes them too, and the optimizer equips the
        # required gear.
        rep_req = reqs.get("reputation") or {}
        if isinstance(rep_req, dict) and rep_req:
            rep_have = {str(k).lower(): v for k, v in (state.reputation or {}).items()}
            for faction, amount in rep_req.items():
                try:
                    need = int(amount)
                except (TypeError, ValueError):
                    need = 0
                if need > 0 and int(rep_have.get(str(faction).lower(), 0) or 0) < need:
                    return False
        try:
            ap_req = int(reqs.get("achievement_points") or 0)
            if ap_req > 0 and state.achievement_points < ap_req:
                return False
        except (TypeError, ValueError):
            pass
    return True


def _recipe_applicable(recipe, state: CharacterStateSnapshot) -> bool:
    """Check if recipe is applicable for character."""
    skill = getattr(recipe, "skill", None)
    if skill:
        skill_name = (skill if isinstance(skill, str) else getattr(skill, "name", "")).lower()
        recipe_level = int(getattr(recipe, "level", None) or 1)
        if state.skill_levels.get(skill_name, 1) < recipe_level:
            return False
    return True


def _service_unlocked(service, state: CharacterStateSnapshot) -> bool:
    """Check if a service is unlocked: skill, faction rep, coins, etc."""
    if service is None:
        return True
    # 2026-06-19 (jwbail): services.py stores `requirements` as a DICT
    # ({keyword_counts, skill:{Skill:lvl}, reputation:{faction:amt},
    # access:[...]}) — NOT the list-of-{type:...} form the legacy branch
    # below iterates. Iterating the dict yields its string KEYS, every one
    # skipped by `if not isinstance(req, dict)`, so the old code enforced
    # NOTHING for dict-form services and returned True unconditionally. A
    # Smithing-55 forge (Cursed Forge) then read as unlocked for a sub-55
    # character; enumerate matched it as the recipe's service while the
    # worker's real ServiceInstance.is_unlocked correctly rejected it, so the
    # recipe's chests_recipes scope ghosted as REASON_NEWLY_UNLOCKED forever.
    # Mirror ServiceInstance.is_unlocked here: enforce skill + reputation +
    # coins-access. keyword_counts are intentionally NOT checked (they need an
    # equipped gearset; is_unlocked(no gearset) tolerates them and the
    # optimizer equips the required gear).
    reqs_attr = getattr(service, "requirements", None)
    if isinstance(reqs_attr, dict):
        for skill, lvl in (reqs_attr.get("skill") or {}).items():
            sk = (skill if isinstance(skill, str) else getattr(skill, "name", "")).lower()
            try:
                need = int(lvl)
            except (TypeError, ValueError):
                need = 0
            if sk and state.skill_levels.get(sk, 1) < need:
                return False
        rep_req = reqs_attr.get("reputation") or {}
        if isinstance(rep_req, dict) and rep_req:
            rep_have = {str(k).lower(): v for k, v in (state.reputation or {}).items()}
            for faction, amount in rep_req.items():
                try:
                    need = int(amount)
                except (TypeError, ValueError):
                    need = 0
                if need > 0 and int(rep_have.get(str(faction).lower(), 0) or 0) < need:
                    return False
        for access in (reqs_attr.get("access") or []):
            if isinstance(access, dict) and access.get("type") == "coins":
                try:
                    need = int(access.get("coins", 0) or 0)
                except (TypeError, ValueError):
                    need = 0
                if state.coins < need:
                    return False
        return True
    # Legacy list-of-dicts requirements form.
    try:
        # Try is_unlocked with our state masquerading as a character-like object
        # The is_unlocked method may take a character arg; fall back to manual check
        reqs = reqs_attr or []
        for req in reqs:
            if not isinstance(req, dict):
                continue
            rt = req.get("type")
            if rt == "skill":
                skill = (req.get("skill") or "").lower()
                if state.skill_levels.get(skill, 1) < req.get("level", 0):
                    return False
            elif rt == "reputation":
                faction = (req.get("faction") or "").lower()
                if state.reputation.get(faction, 0) < req.get("amount", 0):
                    return False
            elif rt == "coins":
                if state.coins < req.get("coins", 0):
                    return False
            elif rt == "achievement_points":
                if state.achievement_points < req.get("amount", 0):
                    return False
            elif rt == "character_level":
                if state.character_level < req.get("level", 0):
                    return False
        return True
    except Exception:
        return True


def _service_location_accessible(service, unlocked_regions, locked_locations) -> bool:
    """Return True if a service's location is in an unlocked, non-locked region.

    Mirrors stats_report_worker._service_location_accessible so the enumerated
    chests_recipes scopes match the services the worker will actually pick.
    Without this, a recipe whose only valid+unlocked service sits in a locked
    region (e.g. Heatstroke Metalworks in Myriadian Arc) would be enumerated as
    applicable here while the worker skips it — ghosting it REASON_NEWLY_UNLOCKED
    forever. Falls back to "accessible" when accessibility data is unavailable.
    """
    loc = getattr(service, "location", None)
    if loc is None:
        return True
    loc_name = loc if isinstance(loc, str) else getattr(loc, "name", "")
    locked = locked_locations or set()
    if loc_name and loc_name in locked:
        return False
    if unlocked_regions is None:
        return True
    regions = getattr(loc, "regions", None) if not isinstance(loc, str) else None
    if regions is None:
        return True
    return any(r in unlocked_regions for r in regions)


def _first_accessible_location(activity, unlocked_regions, locked_locations):
    """Return the first activity location that the character can access.

    Mirrors stats_report_worker._activity_first_accessible_location so the
    enumerated scope tuples match the (cat, sub, src, loc, svc) keys the
    worker actually writes to stats_report_results. Without this match,
    every additional location of a multi-location activity (e.g. Bog Top
    backed by both halfling_rebels and gdte) ghosted as REASON_NEWLY_UNLOCKED
    on every stale-check.

    Falls back to locs[0] when accessibility data is unavailable
    (preserving original behavior).
    """
    locs = getattr(activity, "locations", None) or []
    if not locs:
        return None
    if unlocked_regions is None:
        return locs[0]
    locked = locked_locations or set()
    for loc in locs:
        loc_name = loc if isinstance(loc, str) else getattr(loc, "name", "")
        if loc_name in locked:
            continue
        regions = getattr(loc, "regions", None) if not isinstance(loc, str) else None
        if regions is None:
            return loc
        if any(r in unlocked_regions for r in regions):
            return loc
    return None


def _resolve_accessibility(char_config):
    """Compute (unlocked_regions, locked_locations) from a char_config dict.

    Returns (None, set()) if char_config is missing or detection helpers fail —
    the helper above falls back to locs[0] in that case.
    """
    if not char_config:
        return None, set()
    try:
        from optimize_travel_gearsets import detect_unlocked_regions, detect_locked_locations
        info = detect_unlocked_regions(char_config) or {}
        if isinstance(info, dict):
            unlocked = {r for r, v in (info.get("unlocked") or info).items() if v}
        else:
            unlocked = set(info)
        # Wallisia sub-regions share the Wallisia gate — match worker
        if "wallisia" in unlocked:
            unlocked.update({"ghostly", "spectral"})
        locked = detect_locked_locations(char_config) or set()
        return unlocked, locked
    except Exception:
        return None, set()


def representative_recipe_service_location(
    recipe, state, unlocked_regions, locked_locations, services_by_name
):
    """Return ``(loc_slug, svc_slug)`` for a recipe's chests_recipes stale scope.

    SINGLE SOURCE OF TRUTH for the recipe location/service key, so the write
    side (``stats_report_worker._derive_location`` / ``_derive_service``) and
    the read side (``enumerate_applicable_sources``) cannot diverge. A divergent
    key ghost-flags every recipe forever — see .kiro/RECIPE_LOCATION_STALE_KEY.md.

    - ``svc_slug``: the recipe's ``service`` display-name slug (``'NONE'`` for a
      no-service recipe). UNCHANGED from what is already stored.
    - ``loc_slug``: the location slug of the FIRST service that is valid for the
      recipe AND unlocked AND location-accessible (the exact selection the
      enumerator already uses as its inclusion gate). ``'global'`` for a
      no-service recipe.
    - Returns ``loc_slug = None`` when the recipe HAS a service but no
      unlocked + accessible service can perform it — the caller MUST treat that
      as "not applicable for this character" and skip the scope (mirrors the
      enumerator's ``if matched is None: continue``).

    NOTE: the location is per-character (service accessibility depends on the
    character's unlocked regions), so this is character-state-dependent by
    design. ``services_by_name`` is passed in (not imported) so callers share
    their already-resolved catalog and tests can inject fakes.
    """
    svc_name = getattr(recipe, "service", None)
    if not svc_name or svc_name in ("None", "NONE", ""):
        return ("global", "NONE")
    svc_slug = svc_name.lower().replace(" ", "_").replace("'", "")
    matched = None
    for svc in (services_by_name or {}).values():
        try:
            if (svc.is_valid_for_recipe(recipe)
                    and _service_unlocked(svc, state)
                    and _service_location_accessible(svc, unlocked_regions, locked_locations)):
                matched = svc
                break
        except Exception:
            continue
    if matched is None:
        return (None, svc_slug)
    loc = getattr(matched, "location", None)
    loc_name = loc if isinstance(loc, str) else (getattr(loc, "name", "") or "")
    loc_slug = loc_name.lower().replace(" ", "_").replace("'", "") or "global"
    return (loc_slug, svc_slug)


def enumerate_applicable_sources(
    state: CharacterStateSnapshot, db=None, char_config: dict = None
) -> Set[Tuple[str, str, str, str, str]]:
    """Return set of (category, subcategory, source_name, location, service) tuples
    currently applicable to the character."""
    import util.walkscape_constants  # noqa: F401
    from util.autogenerated.activities import ACTIVITIES_BY_NAME
    from util.autogenerated.recipes import RECIPES_BY_NAME
    try:
        from util.autogenerated.services import SERVICES_BY_NAME
    except ImportError:
        SERVICES_BY_NAME = {}

    applicable: Set[Tuple[str, str, str, str, str]] = set()

    # 2026-05-29: resolve accessibility once so we pick the same first
    # accessible location the worker writes under. Without this, every
    # additional activity.locations entry produced a phantom NEWLY_UNLOCKED
    # row on every stale-check.
    unlocked_regions, locked_locations = _resolve_accessibility(char_config)

    # ── Activities ─────────────────────────────────────────────────────
    for activity in ACTIVITIES_BY_NAME.values():
        if not _activity_applicable(activity, state):
            continue
        primary_skill_obj = getattr(activity, "skill", None) or getattr(activity, "primary_skill", None)
        if not primary_skill_obj:
            continue
        primary_skill = (primary_skill_obj if isinstance(primary_skill_obj, str) else getattr(primary_skill_obj, "name", "")).lower()
        if not primary_skill:
            continue

        # 2026-05-22 fix: activities have `drop_table` + `secondary_drop_table`
        # (NOT `drops` and NOT `chest_drops`). Previous code read non-existent
        # attributes and got [] for everything → enumerate skipped chests +
        # new_items entirely → _filter_jobs_to_stale_only dropped 100% of those
        # categories on a fresh run. See worker's build_chest_jobs and
        # build_new_items_jobs which use the real attributes.
        all_drops = list(getattr(activity, "drop_table", None) or []) + \
                    list(getattr(activity, "secondary_drop_table", None) or [])

        # 2026-05-29: only emit ONE row per activity, keyed to the first
        # accessible location — matching what stats_report_worker writes.
        # Previously this iterated every activity.locations entry, which
        # for multi-location activities (Bog Top backed by halfling_rebels
        # AND gdte) produced phantom NEWLY_UNLOCKED rows for the locations
        # the worker didn't write a row under.
        loc = _first_accessible_location(activity, unlocked_regions, locked_locations)
        if loc is None:
            continue
        loc_str = loc if isinstance(loc, str) else getattr(loc, "name", str(loc))
        loc_slug = loc_str.lower().replace(" ", "_").replace("'", "")

        # 2026-06-02 (jwbail): emit xp scopes for ALL granted skills, not
        # just primary. Worker now writes one stats_report_gearsets row
        # per granted skill (primary + each entry in secondary_xp), so
        # the applicable set must match. Field is `secondary_xp`
        # (dict of {skill: xp_per_action}) on ActivityInfo — NOT the
        # `secondary_xp_skills` name an earlier version of this code
        # iterated; that always-empty getattr made multi-skill activities
        # silently fall back to primary-only.
        xp_skills = {primary_skill}
        sec_xp = getattr(activity, "secondary_xp", None) or {}
        if isinstance(sec_xp, dict):
            for sec in sec_xp.keys():
                sec_str = (sec if isinstance(sec, str) else getattr(sec, "name", "")).lower()
                if sec_str:
                    xp_skills.add(sec_str)
        # 2026-06-19 (jwbail): one-time activities are not repeatable XP
        # farming targets — build_xp_jobs skips them, so the applicable set
        # must not emit an xp scope for them either, or detect_stale_scopes
        # flags the row as REASON_NEWLY_UNLOCKED forever once it unlocks
        # (user report: "Repair the bank shows up in XP"). coins / chests /
        # new_items are still emitted below — a one-time activity remains a
        # legitimate one-off source of its chest and collectible drops.
        if not getattr(activity, "one_time", False):
            for sk in xp_skills:
                applicable.add(("xp", sk, activity.name, loc_slug, "NONE"))

        # coins under primary skill only
        applicable.add(("coins", primary_skill, activity.name, loc_slug, "NONE"))

        # chests: enumerate Container.* refs in the drop tables.
        for d in all_drops:
            ref = getattr(d, "item_ref", "") or ""
            if not ref.startswith("Container."):
                continue
            chest_name = getattr(d, "item_name", "") or ""
            chest_slug = chest_name.lower().replace(" ", "_").replace("'", "")
            if chest_slug:
                applicable.add(("chests", chest_slug, activity.name, loc_slug, "NONE"))

        # new_items: one row per kind that has unowned drops
        kinds_with_drops = _kinds_with_unowned_drops(all_drops, state)
        for kind in kinds_with_drops:
            applicable.add(("new_items", kind, activity.name, loc_slug, "NONE"))

    # ── Recipes (chests_recipes) ───────────────────────────────────────
    for recipe in RECIPES_BY_NAME.values():
        if not _recipe_applicable(recipe, state):
            continue
        # Single source of truth shared with the worker's _derive_location /
        # _derive_service (representative_recipe_service_location). Returns the
        # real per-character service location so the stored dominance_bitmap is
        # computed at the actual crafting location (not "global"). loc_slug=None
        # means the recipe has a service but none is unlocked + accessible for
        # this character — skip, exactly like the old `if matched is None:
        # continue` gate. svc_slug is the recipe.service display-name slug,
        # unchanged from what is already stored.
        loc_slug, svc_slug = representative_recipe_service_location(
            recipe, state, unlocked_regions, locked_locations, SERVICES_BY_NAME)
        if loc_slug is None:
            continue

        # 2026-05-22 fix: recipes use `drop_table` (list of dicts) for
        # chest drops, NOT `chest_drops`. Each dict has `item_name` +
        # `item_ref`. Filter to Container.* refs. Mirrors the worker's
        # build_chests_recipes_jobs logic.
        drops = getattr(recipe, "drop_table", None) or []
        for d in drops:
            if not isinstance(d, dict):
                continue
            ref = d.get("item_ref", "") or ""
            if not ref.startswith("Container."):
                continue
            chest_name = d.get("item_name", "") or ""
            chest_slug = chest_name.lower().replace(" ", "_").replace("'", "")
            if chest_slug:
                applicable.add(("chests_recipes", chest_slug, recipe.name, loc_slug, svc_slug))

    return applicable


def _kinds_with_unowned_drops(drops, state: CharacterStateSnapshot) -> Set[str]:
    """Return subcategory kinds that have at least one drop the character doesn't own."""
    kinds: Set[str] = set()
    # 2026-06-19 (jwbail): mirror stats_report_worker.build_new_items_jobs'
    # per-kind ownership model so we never surface a kind the worker won't
    # build a job for (which would ghost as REASON_NEWLY_UNLOCKED forever):
    #   * eggs        — "owned" if the character has a PET of that species
    #                   (the egg would only hatch a duplicate). owned_items
    #                   never carries the egg item, so without this an owned
    #                   species' egg looked perpetually unowned.
    #   * collectibles— "owned" if the slug is in owned_collectibles.
    #                   Collectibles aren't in owned_items (not gear / not in
    #                   the dominance bitmap), so the generic owned_items check
    #                   below could never see them.
    owned_species = {sp for (sp, _lvl) in (getattr(state, "owned_pets", None) or ())}
    owned_collectibles = getattr(state, "owned_collectibles", frozenset()) or frozenset()
    for d in (drops or []):
        item_name = getattr(d, "item_name", None) or (d if isinstance(d, str) else None)
        if not item_name:
            continue
        # 2026-06-22 (jwbail, report 2316c608): normalize with the canonical
        # normalize_item_id (shared with the worker + state_snapshot) so the
        # drop slug matches the owned sets on both sides. The old inline
        # transform kept hyphens, so '99-year-old wine' -> '99-year-old_wine'
        # never matched the worker-normalized owned collectible
        # '99_year_old_wine' -> the scope ghosted as NEWLY_UNLOCKED forever.
        slug = normalize_item_id(str(item_name))
        # Convention: drops are base quality
        if (slug, "normal") in state.owned_items:
            continue  # already owned
        if slug in state.hidden_items:
            continue  # hidden
        # Determine kind from drop reference
        item_ref = getattr(d, "item_ref", "") or ""
        if "Egg." in item_ref:
            # Mirror the worker: a pet of this species means the egg is "owned".
            species_id = slug.replace("_egg", "").strip("_")
            if species_id in owned_species:
                continue
            kinds.add("eggs")
        elif "Collectible." in item_ref:
            if slug in owned_collectibles:
                continue
            kinds.add("collectibles")
        elif "Item." in item_ref:
            # Could be tools or gear depending on item slot
            kinds.add(_classify_item_kind(slug))
    return kinds


def _classify_item_kind(slug: str) -> str:
    """Classify an Item-class slug into 'tools' or 'gear' (or fallback)."""
    catalog_lookup = _catalog_lookup_cache()
    item = catalog_lookup.get(slug)
    if item is None:
        return "gear"
    slot = (getattr(item, "slot", None) or "").lower()
    if slot.startswith("tool"):
        return "tools"
    return "gear"


_CATALOG_LOOKUP_CACHE = None


def _catalog_lookup_cache():
    global _CATALOG_LOOKUP_CACHE
    if _CATALOG_LOOKUP_CACHE is not None:
        return _CATALOG_LOOKUP_CACHE
    import util.walkscape_constants  # noqa: F401
    from util.autogenerated.equipment import Item, ItemInstance, AchievementItem, CraftedItem
    out = {}
    for n in dir(Item):
        if n.startswith("_"):
            continue
        v = getattr(Item, n, None)
        if isinstance(v, (ItemInstance, AchievementItem, CraftedItem)):
            out[n.lower()] = v
    _CATALOG_LOOKUP_CACHE = out
    return out
