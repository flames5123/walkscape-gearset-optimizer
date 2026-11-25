#!/usr/bin/env python3
"""
Per-session "can hand in now" computation for the Job Board page — the three
engine-backed modes the client can't do alone:

  * owned_materials    — you own ALL raw materials (1:1, full crafting tree,
                         ignoring NMC/DR) to craft each crafted goal item's
                         needed quantity. Owning a crafted intermediate counts.
  * partial_materials  — you own SOME material in a crafted goal's tree.
  * can_obtain         — every goal item is reachable: owned, bought from an
                         unlocked shop, dropped by an activity you can do right
                         now (authoritative skill/location/gear/special-req gate
                         via stats_report_worker._sr_gate_activity), or craftable
                         from obtainable inputs with the recipe's skill+region met.

Returns a map {job_id: {owned_materials, partial_materials, can_obtain}}. The
owned/safe-owned and trade-listings modes are handled client-side.

Material quantities: a recipe's ``materials`` is an AND-list of OR-groups of
``(qty, item)``; ``quantity`` is the yield per craft. A group is satisfied if
ANY alternative is satisfiable. Depth- and cycle-capped.
"""

import math
from typing import Any, Dict, List, Optional, Set, Tuple

_MAX_DEPTH = 8


def _canon(name: str) -> str:
    return (name or "").lower().replace(" ", "_").replace("(", "").replace(")", "").replace("-", "_").replace("'", "")


def _build_indexes(game: dict):
    """Return (slug->ref, ref->[recipes], ref->[activities], ref->slug)."""
    from util.walkscape_constants import Material, Item, Consumable

    slug_to_ref: Dict[str, str] = {}
    ref_to_slug: Dict[str, str] = {}
    for cls_name, cls in (("Material", Material), ("Item", Item), ("Consumable", Consumable)):
        for attr in dir(cls):
            if attr.startswith("_"):
                continue
            obj = getattr(cls, attr)
            nm = getattr(obj, "name", None)
            if not isinstance(nm, str):
                continue
            ref = f"{cls_name}.{attr}"
            slug = _canon(nm)
            # First writer wins; Material/Item/Consumable rarely collide on slug.
            slug_to_ref.setdefault(slug, ref)
            ref_to_slug[ref] = slug

    recipes_by_out: Dict[str, List[Any]] = {}
    for rec in game["recipes"].values():
        out = getattr(rec, "output_item", None)
        if out:
            recipes_by_out.setdefault(out, []).append(rec)

    acts_by_ref: Dict[str, List[Any]] = {}
    for act in game["activities"].values():
        drops = list(getattr(act, "drop_table", []) or []) + list(getattr(act, "secondary_drop_table", []) or [])
        seen = set()
        for d in drops:
            ref = getattr(d, "item_ref", None) if not isinstance(d, dict) else d.get("item_ref")
            if ref and ref not in seen:
                seen.add(ref)
                acts_by_ref.setdefault(ref, []).append(act)
    return slug_to_ref, recipes_by_out, acts_by_ref, ref_to_slug


def _mat_ref(obj) -> Optional[str]:
    from ui.crafting_tree import _get_item_ref_string
    try:
        return _get_item_ref_string(obj)
    except Exception:
        return None


def compute_handin(db, session_uuid: str) -> Dict[int, Dict[str, bool]]:
    rows = db.job_board_jobs_for_latest_week()
    if not rows:
        return {}
    item_map = db.job_board_item_map()

    from ui.crafting_tree import _load_game_data, get_available_sources
    from ui.stats_report_worker import load_character, _sr_gate_activity
    from ui.app import _owned_qualities_by_item_id, _compute_region_unlock
    from ui.job_board_service import BOARD_META

    game = _load_game_data()
    slug_to_ref, recipes_by_out, acts_by_ref, ref_to_slug = _build_indexes(game)

    owned_q = _owned_qualities_by_item_id(session_uuid) or {}
    owned_total: Dict[str, int] = {}
    for slug, toks in owned_q.items():
        try:
            owned_total[slug] = sum(int(v) for v in toks.values())
        except Exception:
            owned_total[slug] = 0

    try:
        char = load_character(session_uuid, db.db_path)
    except Exception:
        char = None

    # Unlocked regions — derive from the character the SAME way the crafting
    # tree / travel / goals report do (owned diving gear / essence / letter of
    # passage), NOT from a raw stored field. _compute_region_unlock fails OPEN
    # (all regions enabled) when the detector is unavailable, so we never
    # falsely lock a progressed player.
    char_cfg = {}
    try:
        sess = db.get_session(session_uuid) or {}
        char_cfg = sess.get("character_config") or {}
        if not isinstance(char_cfg, dict):
            char_cfg = {}
    except Exception:
        char_cfg = {}

    unlocked_regions = set()
    try:
        _ru = _compute_region_unlock(char_cfg) or {}
        unlocked_regions = {r for r, v in (_ru.get("unlocked") or {}).items() if v}
    except Exception:
        unlocked_regions = set()

    # Feed the computed unlocks into the source enumerator too (shops/activities
    # are region-gated via session_data['region_unlocks']).
    session_data = {"region_unlocks": sorted(unlocked_regions)}

    # Board-access gate: a job is only obtainable if you can reach its board.
    # A board's curated faction slugs ARE its gating regions (erdwise / trellin
    # / halfling_rebels / syrenthia / jarvonia); 'tutorial_area' never gates.
    # Fail open when region detection returned nothing.
    def board_accessible(board_slug: Optional[str]) -> bool:
        regions = [r for r in (BOARD_META.get(board_slug or "", {}).get("factions") or [])
                   if r != "tutorial_area"]
        if not regions:
            return True            # tutorial / ungated board
        if not unlocked_regions:
            return True            # detection unavailable -> don't falsely lock
        return bool(set(regions) & unlocked_regions)

    def owned(ref: str) -> int:
        return owned_total.get(ref_to_slug.get(ref) or "", 0)

    # ── materials ownership (does owned fully cover the subtree?) ──────────────
    _full_cache: Dict[Tuple[str, int], bool] = {}

    def subtree_fully_owned(ref: str, qty: int, depth: int, path: Set[str]) -> bool:
        if qty <= 0:
            return True
        key = (ref, qty)
        if key in _full_cache:
            return _full_cache[key]
        if owned(ref) >= qty:
            _full_cache[key] = True
            return True
        recs = recipes_by_out.get(ref) or []
        if not recs or depth >= _MAX_DEPTH or ref in path:
            _full_cache[key] = False
            return False
        rec = recs[0]
        crafts = math.ceil(qty / max(1, getattr(rec, "quantity", 1) or 1))
        # outer = alternative combos (pick one), inner = all-required materials.
        # Fully owned iff SOME combo has EVERY material fully owned/craftable.
        combos = getattr(rec, "materials", []) or []
        ok = False
        for combo in combos:
            if combo and all(
                _mat_ref(obj) and subtree_fully_owned(_mat_ref(obj), q * crafts, depth + 1, path | {ref})
                for (q, obj) in combo
            ):
                ok = True
                break
        _full_cache[key] = ok
        return ok

    def any_material_owned(ref: str, qty: int, depth: int, path: Set[str]) -> bool:
        recs = recipes_by_out.get(ref) or []
        if not recs or depth >= _MAX_DEPTH or ref in path:
            return False
        rec = recs[0]
        crafts = math.ceil(qty / max(1, getattr(rec, "quantity", 1) or 1))
        for group in (getattr(rec, "materials", []) or []):
            for (q, obj) in group:
                sref = _mat_ref(obj)
                if not sref:
                    continue
                if owned(sref) > 0:
                    return True
                if any_material_owned(sref, q * crafts, depth + 1, path | {ref}):
                    return True
        return False

    # Can you make ONE craft of this item right now from what you own — where a
    # material counts as "owned" if you hold it OR can craft it from owned
    # sub-materials (e.g. you don't hold Linen cloth but own the Flax/Hemp to
    # make it)? Drives the material-icon color: green = yes, yellow = not quite.
    # "One craft" = a single recipe invocation (quantity 1 of the output).
    def one_craft_ready(ref: str) -> bool:
        return subtree_fully_owned(ref, 1, 0, set())

    # ── can_obtain (reachability) ──────────────────────────────────────────────
    _obtain_cache: Dict[str, bool] = {}

    def obtainable(ref: str, depth: int, path: Set[str]) -> bool:
        if ref in _obtain_cache:
            return _obtain_cache[ref]
        if owned(ref) > 0:
            _obtain_cache[ref] = True
            return True
        if depth >= _MAX_DEPTH or ref in path:
            return False
        _obtain_cache[ref] = False  # guard against cycles while computing
        result = False
        # Activity drops — authoritative "can I do this now" gate.
        if char is not None:
            for act in acts_by_ref.get(ref, []):
                try:
                    inc, _unmet = _sr_gate_activity(act, char)
                except Exception:
                    inc = False
                if inc:
                    result = True
                    break
        # Shops (region-gated) via the source enumerator.
        if not result:
            try:
                srcs = get_available_sources(ref, game, session_data, True)
            except Exception:
                srcs = []
            if any(s.get("type") == "shop" and not s.get("is_spoiler") for s in srcs):
                result = True
            # Recipes: skill + region met, and every input group has an
            # obtainable alternative.
            if not result:
                ok_recipe_ids = {s.get("source_id") for s in srcs
                                 if s.get("type") == "recipe" and not s.get("is_spoiler")}
                for rec in recipes_by_out.get(ref, []):
                    if rec.name not in ok_recipe_ids:
                        continue
                    if char is not None:
                        try:
                            if char.get_skill_level(getattr(rec, "skill", "")) < (getattr(rec, "level", 0) or 0):
                                continue
                        except Exception:
                            pass
                    groups_ok = False
                    for combo in (getattr(rec, "materials", []) or []):
                        # outer = alternative combos (OR), inner = all-required
                        # materials (AND). A recipe is doable if SOME combo has
                        # EVERY material obtainable.
                        if combo and all(
                            _mat_ref(obj) and obtainable(_mat_ref(obj), depth + 1, path | {ref})
                            for (q, obj) in combo
                        ):
                            groups_ok = True
                            break
                    if groups_ok:
                        result = True
                        break
        _obtain_cache[ref] = result
        return result

    def goal_refs(goal) -> List[Tuple[str, int]]:
        """(ref, quantity) for a goal's base item (alternatives share the slug)."""
        from ui.job_board_service import item_slug as _derive_slug
        it = goal.get("item") or {}
        iid = it.get("id")
        slug = (item_map.get(iid) or {}).get("slug") or _derive_slug(iid)
        ref = slug_to_ref.get(slug) if slug else None
        if not ref:
            return []
        return [(ref, goal.get("quantity") or 0)]

    import json as _json
    out: Dict[int, Dict[str, bool]] = {}
    mat_colors: Dict[str, str] = {}   # item slug -> 'green' | 'yellow'
    for row in rows:
        try:
            goals = _json.loads(row.get("goals_json") or "[]")
        except Exception:
            goals = []
        can = bool(goals) and board_accessible(row.get("board_slug"))
        om = bool(goals)
        pm = False
        om_has_craft = False
        for g in goals:
            refs = goal_refs(g)
            if not refs:
                can = False
                om = False
                continue
            ref, qty = refs[0]
            if not obtainable(ref, 0, set()):
                can = False
            # materials only apply to craftable goal items
            if recipes_by_out.get(ref):
                om_has_craft = True
                if not subtree_fully_owned(ref, qty, 0, set()):
                    om = False
                if any_material_owned(ref, qty, 0, set()) or owned(ref) > 0:
                    pm = True
                # Per-(job,item) material-icon color: GREEN only when you can
                # fully source the WHOLE needed quantity (own it, or craft it
                # from what you own); YELLOW when still short. eff subtracts any
                # finished copies you already hold, matching the popup's counts.
                slug = ref_to_slug.get(ref)
                if slug:
                    eff = max(0, (qty or 0) - owned(ref))
                    green = (eff <= 0) or subtree_fully_owned(ref, eff, 0, set())
                    mat_colors["{}|{}".format(row["id"], slug)] = 'green' if green else 'yellow'
        out[int(row["id"])] = {
            "can_obtain": can,
            "owned_materials": bool(om and om_has_craft),
            "partial_materials": bool(pm),
            "has_crafts": bool(om_has_craft),
        }
    return {"handin": out, "mat_colors": mat_colors}
