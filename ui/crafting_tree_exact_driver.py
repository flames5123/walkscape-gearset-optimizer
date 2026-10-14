"""PROTOTYPE — bottom-up EXACT crafting-tree optimizer driver.

Gated behind global_settings['exact_tree'] (default OFF). When on,
optimize_crafting_tree delegates here instead of the heuristic per-node +
route-trial pass. The heuristic path is the default and is untouched.

Two phases:

  Phase 0 — exact Best(auto) route re-resolution (ambiguous nodes only):
    for each candidate source subtree, solve it bottom-up exactly and read the
    Best(auto) node's cumulative steps/target; pick the min and splice that
    route into the live tree via on_source_change. Replaces the heuristic's
    trial-optimize fan-out with one exact solve per candidate subtree.

  Phase 1 — final bottom-up solve (leaves -> root, each node once):
    - leaf (activity/gather/chest): util.exact_target_rate_optimizer
    - recipe: util.exact_craft_steps_optimizer with a downstream-weighted
        objective  total_steps_per_output = engine_steps/(oq+IF)
                                            + (1-NMC)*M0/oq,  / [(1+DR)*qp]
        where M0 = Σ_child base_req_c * cum[child].

Each solved gearset is encoded onto node.gear_config.optimized_export; the caller
runs calculate_tree for the authoritative per-node metrics + summary. No
route-trial fan-out. Validated ~10s on report snapshot 938d048e (2m23s+ heuristic
timeout).
"""
import copy
import json
import time


# ── character reconstruction ──────────────────────────────────────────────
def _build_character_from_config(character_config, ui_config=None):
    """Reconstruct a Character from the stored session character_config.

    Mirrors ui/optimize_worker.py's minimal_export reconstruction (skills via
    level_to_xp + skills_xp override; inventory from owned_items + item_qualities
    quality variants) so the exact solver sees the same levels + gear pool the
    heuristic worker would."""
    from util.walkscape_constants import level_to_xp
    from util.character_export_util import Character
    cc = character_config or {}
    skills = {}
    for sk, lvl in (cc.get('skills') or {}).items():
        skills[sk] = level_to_xp(lvl)
    for sk, xp in (cc.get('skills_xp') or {}).items():
        skills[sk] = xp
    q2s = {'Normal': '_common', 'Good': '_uncommon', 'Great': '_rare',
           'Excellent': '_epic', 'Perfect': '_legendary', 'Eternal': '_ethereal'}
    inv = {}
    for en in (cc.get('owned_items') or []):
        inv[en] = inv.get(en, 0) + 1
    for iid, quals in (cc.get('item_qualities') or {}).items():
        for q, qty in (quals or {}).items():
            en = f"{iid}{q2s.get(q, '_common')}"
            inv[en] = max(inv.get(en, 0), qty)
    export = {
        "name": cc.get('name', 'Player'), "game_version": cc.get('game_version', '1.0'),
        # steps drives get_character_level() -> tool_slots_for_level(): omitting it
        # collapsed the reconstructed character to level ~2 (3 tool slots) no matter
        # the reporter's real progression, so the exact solver only ever used 3 of
        # their unlocked tool slots. achievement_points / coins gate a handful of
        # AP- and wealth-scoped items; custom_stats carries the UI's
        # activity-completion / explored-realm toggles. Mirror optimize_worker's
        # minimal_export so the exact solve sees the SAME character the heuristic
        # worker does. (bug 938d048e — exact optimizer only filling 3/5 tool slots.)
        "steps": cc.get('steps', 0),
        "achievement_points": cc.get('achievement_points', 0),
        "coins": cc.get('coins', 0),
        "skills": skills, "reputation": cc.get('reputation', {}), "inventory": inv,
        "bank": {}, "gear": {}, "collectibles": cc.get('collectibles', []),
        "custom_stats": ((ui_config or {}).get('custom_stats') or {}),
    }
    return Character(json.dumps(export))


def _material_req_for_child(recipe, child_item_id, child_node=None):
    """Base material amount the recipe consumes for the given child item (first
    matching material group). Falls back to 1.

    PREFERS the child node's own ``base_requirement_amount`` — the SAME value
    build_crafting_tree stored from the recipe's material tuple and the value
    the display path (ui/crafting_tree.calculate_node_metrics) uses. Reading it
    directly keeps the exact route-selection metric in lockstep with the
    displayed steps/item (bug: the exact optimizer picked a route the display
    then rendered as far more expensive).

    The name-matching fallback (used only when no node is available) previously
    compared the item id's short name — e.g. ``ectoplasm_scraps`` (UNDERSCORE) —
    as a substring of ``str(MaterialInstance)`` — e.g.
    ``materialinstance(ectoplasm scraps)`` (SPACE). The underscore never matched
    the space, so EVERY multi-material recipe fell through to the ``1`` fallback,
    grossly undercounting downstream cost (Weave into ectoplasm needs 5 scraps
    but was treated as 1, so it looked ~5x cheaper and was wrongly chosen over
    Cut/Smelt/Cook). Normalize underscores to spaces and match against the
    material's canonical ``.name`` so the fallback is also correct.
    """
    # Authoritative: the value build_crafting_tree already computed for this
    # child (same as the display path). No string matching needed.
    if child_node is not None:
        bra = child_node.get('base_requirement_amount')
        try:
            if bra is not None and float(bra) > 0:
                return float(bra)
        except (TypeError, ValueError):
            pass
    # Fallback: normalized name match (underscore -> space; match on .name).
    cid = (child_item_id or '').split('.')[-1].lower().replace('_', ' ')
    for grp in (getattr(recipe, 'materials', None) or []):
        for qreq, mat in grp:
            mname = (getattr(mat, 'name', '') or str(mat)).lower()
            if cid and cid in mname:
                return qreq
        break  # only the first (default) material group for the prototype
    return 1


def _fine_leaf_target(item, tgt, use_fine, act, character, location):
    """Decide the drop-name a gather leaf should optimize for, and whether it is
    a fine target. Mirrors the heuristic `cat:fine` default and the goals-report
    steps/target-item path.

    In fine mode, a gather leaf must optimize for the FINE drop. The tree does
    NOT always rewrite gather nodes to Material.X_FINE (a base material feeding a
    fine-capable recipe keeps its base ref), so `tgt` would otherwise resolve to
    the NON-fine drop key and the exact leaf would optimize the wrong objective
    (bug 8a2a98f3). When `item` has a *_FINE variant that `act` actually drops
    (graceful degradation — if the activity has no fine entry we keep the base
    target), return (fine_name, True). Already-fine nodes report is_fine=True so
    the caller routes them to the multiplicative fine-rate optimizer too.

    Returns (target_name, is_fine_target).
    """
    if item and item.endswith('_FINE'):
        return tgt, True
    if use_fine and item and item.startswith('Material.'):
        try:
            from ui.crafting_tree import _resolve_item_ref as _rir
            _fine_obj = _rir(item + '_FINE')
            _fine_name = getattr(_fine_obj, 'name', None) if _fine_obj else None
            if _fine_name:
                _dr = act.get_expected_drop_rate(
                    {}, location=location, target_item=None, character=character)
                if _fine_name in (_dr or {}):
                    return _fine_name, True
        except Exception:
            pass
    return tgt, False


def _cap_route_candidates(cands, max_total=6, max_chest=1):
    """Bound the candidate set the same way the heuristic route resolver does:
    keep all direct (recipe/activity) routes + at most one chest; hard ceiling
    on the total so a material with dozens of incidental chest sources can't
    explode the trial count."""
    non_chest = [c for c in cands if c.get('type') != 'chest']
    chests = [c for c in cands if c.get('type') == 'chest']
    capped = (non_chest + chests[:max_chest]) if non_chest else chests[:3]
    return capped[:max_total]


# ── pet / consumable candidate pools (gated on the UI toggles) ─────────────
def _build_gear_pools(character, character_config, ui_config, global_settings,
                      log, session_uuid):
    """Build the pet + consumable candidate pools the exact per-node solves feed
    into their `pets=` / `consumables=` args, gated on the same optimize_pets /
    optimize_consumables toggles the heuristic worker uses.

    Without this the exact driver called the optimizers with pets=None /
    consumables=None, so pets + consumables were silently ignored even when the
    user toggled them on (bug 938d048e follow-up). Pools are built ONCE and
    skill-filtered per node in _solve_node."""
    pets, consumables = [], []
    if global_settings.get('optimize_pets'):
        try:
            from ui.optimize_worker import _build_pet_items_from_character_config
            pets = _build_pet_items_from_character_config(
                character_config or {}, ui_config or {}) or []
        except Exception as e:  # noqa: BLE001 — never crash the optimize
            log(f"  [ct-exact] pet pool build failed: {e!r}", session_uuid)
            pets = []
    if global_settings.get('optimize_consumables'):
        try:
            # Consumables are the items in the character's pool that carry a
            # `duration` attr (matches optimize_worker's include_consumables path).
            #
            # Hidden filter: the heuristic worker excludes any item the user
            # flagged as hidden (column-1 eye icon) via build_hidden_items_set,
            # but the exact driver reconstructs its Character straight from
            # character_config.owned_items / item_qualities and never consulted
            # ui_config's hide overrides — so hidden consumables leaked into the
            # exact solve's pool and got selected (bug d773a4d7). Filter them out
            # here so the exact path honors the SAME hide state the heuristic
            # path does. Pets are already hidden-filtered inside
            # _build_pet_items_from_character_config (via _get_hidden_pet_ids).
            # Shrinking the pool also curbs the B&B node-budget blowups that made
            # exact sets come out worse than the heuristic ones.
            hidden_items = set()
            try:
                from ui.optimize_worker import build_hidden_items_set
                hidden_items = build_hidden_items_set(ui_config or {}) or set()
            except Exception as e:  # noqa: BLE001 — filter is best-effort
                log(f"  [ct-exact] hidden-items set build failed: {e!r}", session_uuid)
                hidden_items = set()
            all_consumables = [it for it, qty in (getattr(character, 'items', {}) or {}).items()
                               if qty and getattr(it, 'duration', None) is not None]
            _ce_use_hidden = (ui_config or {}).get('consumable_use_hidden', False) is True
            consumables = all_consumables if _ce_use_hidden else [it for it in all_consumables if it not in hidden_items]
            # Apply global Consumable Options (Include Fine Consumables +
            # "Ignore consumables I own X or less of").
            try:
                from ui.optimize_worker import apply_consumable_option_filters
                _ce_fine = (ui_config or {}).get('include_fine_consumables', True) is not False
                _ce_min_en = (ui_config or {}).get('consumable_min_owned_enabled', False) is True
                try:
                    _ce_min = int((ui_config or {}).get('consumable_min_owned', 5))
                except (TypeError, ValueError):
                    _ce_min = 5
                _ce_min_op = str((ui_config or {}).get('consumable_min_owned_operator', 'lt') or 'lt').lower()
                consumables = apply_consumable_option_filters(
                    consumables, (getattr(character, 'items', {}) or {}),
                    include_fine=_ce_fine, min_owned_enabled=_ce_min_en, min_owned=_ce_min,
                    min_owned_op=_ce_min_op)
            except Exception as e:  # noqa: BLE001 — options filter is best-effort
                log(f"  [ct-exact] consumable options filter failed: {e!r}", session_uuid)
            n_hidden = len(all_consumables) - len(consumables)
            if n_hidden:
                log(f"  [ct-exact] filtered {n_hidden} hidden consumable(s) from pool",
                    session_uuid)
        except Exception as e:  # noqa: BLE001
            log(f"  [ct-exact] consumable pool build failed: {e!r}", session_uuid)
            consumables = []
    log(f"  [ct-exact] gear pools: optimize_pets={bool(global_settings.get('optimize_pets'))} "
        f"pets={len(pets)} optimize_consumables={bool(global_settings.get('optimize_consumables'))} "
        f"consumables={len(consumables)}", session_uuid)
    return pets, consumables


def _filter_pool(items, skill, kind, is_recipe):
    """Narrow a pet/consumable pool to the candidates relevant to a node's skill
    (mirrors optimize_worker._filter_pet_consumable_candidates_by_skill) so the
    B&B doesn't waste budget on irrelevant pets/consumables. Returns the input
    unfiltered on any failure."""
    if not items:
        return []
    try:
        from ui.optimize_worker import _filter_pet_consumable_candidates_by_skill
        return _filter_pet_consumable_candidates_by_skill(
            items, skill, item_kind=kind, is_recipe=is_recipe)
    except Exception:
        return list(items)


# ── pinned (locked-slot) consumable / pet resolution ───────────────────────
def _resolve_pinned_consumable(slot_info):
    """Resolve a node's locked `consumable` slot_info ({itemId, quality}) to a
    ConsumableItem, or None. Mirrors the consumable branch of optimize_worker's
    locked_slots resolver so the exact path honours a pinned consumable the same
    way the heuristic path does (bug cccc3581 / 1f19d6da)."""
    if not isinstance(slot_info, dict):
        return None
    item_id = slot_info.get('itemId')
    quality = slot_info.get('quality')
    if not item_id:
        return None
    try:
        from util.autogenerated.consumables import Consumable as ConsumableLookup
    except Exception:
        return None
    found = ConsumableLookup.by_export_name(item_id)
    if not found:
        for attr_name in dir(ConsumableLookup):
            if attr_name.startswith('_'):
                continue
            cons = getattr(ConsumableLookup, attr_name)
            if hasattr(cons, 'name'):
                check_id = (cons.name.lower().replace(' ', '_').replace('(', '')
                            .replace(')', '').replace('-', '_').replace("'", ''))
                if check_id == item_id:
                    found = cons
                    break
    # "Fine" pin -> the _fine variant (mirrors optimize_worker).
    if not found and quality and str(quality).lower() == 'fine':
        found = ConsumableLookup.by_export_name(item_id + '_fine')
    return found


def _resolve_pinned_pet(slot_info, character_config):
    """Resolve a node's locked `pet` slot_info ({itemId, quality/level}) to a
    PetInfo (level-resolved), or None. Mirrors the pet branch of
    optimize_worker's locked_slots resolver."""
    if not isinstance(slot_info, dict):
        return None
    item_id = slot_info.get('itemId')
    if not item_id:
        return None
    try:
        from util.autogenerated.pets import Pet as PetLookup, PETS_BY_NAME
    except Exception:
        return None
    found = None
    pet_enum_name = str(item_id).upper()
    if hasattr(PetLookup, pet_enum_name):
        found = getattr(PetLookup, pet_enum_name)
    if not found:
        for pet_name, pet_levels in PETS_BY_NAME.items():
            check_id = pet_name.lower().replace(' ', '_').replace("'", '')
            if check_id == item_id:
                found = pet_levels
                break
    if found is None:
        return None
    # PetLevels -> a specific PetInfo level. Prefer an explicit level in the
    # slot_info / quality, else the character's owned level for this species,
    # else the highest available.
    if hasattr(found, 'get_level'):
        level = None
        q = slot_info.get('quality')
        if q is not None and str(q).isdigit():
            level = int(q)
        if slot_info.get('level') is not None:
            try:
                level = int(slot_info.get('level'))
            except (TypeError, ValueError):
                pass
        if level is None:
            species = str(item_id).lower()
            for pd in (character_config or {}).get('pets', []) or []:
                if isinstance(pd, dict) and str(pd.get('species', '')).lower() == species:
                    try:
                        level = int(pd.get('level', 0)) or None
                    except (TypeError, ValueError):
                        level = None
                    break
        info = None
        if level:
            info = found.get_level(level)
        if info is None:
            all_levels = found.get_all_levels() if hasattr(found, 'get_all_levels') else {}
            if all_levels:
                info = all_levels[max(all_levels.keys())]
        return info
    return found


def _pinned_overlay_and_meta(n, node_skill, location, character, character_config,
                             log, session_uuid):
    """For a node, resolve its pinned consumable + pet (locked_slots), returning
    (overlay_stats, cons_obj, cons_meta, pet_obj, pet_meta). overlay_stats is the
    additive stat dict (consumable + pet) folded into the exact gear solve so the
    gearset is optimized WITH the pinned items active and the displayed QO is
    correct. cons_meta / pet_meta are the gc['optimized_consumable'] /
    gc['optimized_pet'] shapes to force into the solved node."""
    locked = (n.get('locked_slots') or {}) if isinstance(n.get('locked_slots'), dict) else {}
    overlay = {}
    cons_obj = cons_meta = pet_obj = pet_meta = None
    cons_obj = _resolve_pinned_consumable(locked.get('consumable'))
    pet_obj = _resolve_pinned_pet(locked.get('pet'), character_config)
    for obj in (cons_obj, pet_obj):
        if obj is None:
            continue
        try:
            st = obj.get_stats_for_skill(node_skill, location=location, character=character) or {}
            for k, v in st.items():
                try:
                    overlay[k] = overlay.get(k, 0.0) + float(v)
                except (TypeError, ValueError):
                    continue
        except Exception as e:  # noqa: BLE001 — overlay is best-effort
            log(f"  [ct-exact] pinned stat overlay failed: {e!r}", session_uuid)
    if cons_obj is not None:
        _cname = getattr(cons_obj, 'name', '') or ''
        _base = _cname.replace(' (Fine)', '').replace('(Fine)', '').strip()
        _cid = (_base.lower().replace(' ', '_').replace('(', '')
                .replace(')', '').replace('-', '_').replace("'", ''))
        cons_meta = {
            'itemId': _cid, 'name': _cname,
            'is_fine': _cname.endswith('(Fine)') or _cname.endswith(' (Fine)'),
            'rarity': 'common', 'type': 'consumable',
        }
    if pet_obj is not None:
        _pname = getattr(pet_obj, 'name', '') or ''
        pet_meta = {
            'itemId': _pname.lower().replace(' ', '_'), 'name': _pname,
            'level': int(getattr(pet_obj, 'level', 0) or 0),
            'variant': getattr(pet_obj, 'variant', None) or 'normal',
            'rarity': 'common', 'type': 'pet',
        }
    return overlay, cons_obj, cons_meta, pet_obj, pet_meta


# Axes where a higher value is strictly better / strictly worse for a crafting
# or gather node. Used by the single-swap dominance guard below.
_DOM_MORE_IS_BETTER = frozenset({
    'work_efficiency', 'double_action', 'double_rewards', 'no_materials_consumed',
    'quality_outcome', 'chest_finding', 'fine_material_finding', 'find_collectibles',
    'bonus_xp_add', 'bonus_xp_percent', 'inventory_space',
})
_DOM_LESS_IS_BETTER = frozenset({'steps_add', 'steps_percent'})
# Craft-steps objective axes only (recipe nodes). Item-finding stats are inert
# for a craft, so they must NOT enter the recipe dominance comparison.
_DOM_CRAFT_MORE = frozenset({
    'work_efficiency', 'double_action', 'double_rewards',
    'no_materials_consumed', 'quality_outcome',
})
# Single-occupancy gear slots the guard may reorder. Tool slots are excluded —
# a tool's value is set-dependent (keyword coverage across the 6 tool slots), so
# per-slot dominance is not valid there. pet/consumable/secondary are handled
# separately (pins + subset scoring).
_DOM_GEAR_SLOTS = ('head', 'cape', 'back', 'chest', 'hands', 'legs', 'neck',
                   'feet', 'ring1', 'ring2')


def _dominance_swap_gear(gear, skill, location, character, log, session_uuid,
                         more_axes=_DOM_MORE_IS_BETTER, less_axes=_DOM_LESS_IS_BETTER):
    """Single-swap dominance guard (bug cccc3581 / 1f19d6da). The exact B&B can
    hit its node budget on a large pool (e.g. a 15-pet candidate set bloats the
    search) and return a NON-proof-optimal incumbent that leaves a strictly
    worse item in a slot — e.g. the Treasure hunter bandolier (DR 2%) where
    Zorre's desert gourdpack (DA 3% + DR 3%, same QO) was owned and strictly
    better at Myriadian Arc.

    Because the engine objective is monotone in every axis (more W/DA/DR/NMC/QO,
    fewer steps) and gear stats are ADDITIVE across slots, swapping any single
    slot to an owned item that strictly dominates the current pick there can
    only improve (or tie) the global objective. So an independent per-slot
    dominance sweep is provably safe and never regresses the gearset. Mutates
    and returns `gear`.

    `more_axes` / `less_axes` MUST be scoped to the axes that actually enter
    THIS node's objective: a recipe (craft-steps) node must compare ONLY craft
    axes (W/DA/DR/NMC/QO/steps) and ignore item-finding stats (chest_finding,
    find_collectibles, …) — otherwise an inert finding stat on one candidate
    (the bandolier's find_collectibles) wrongly blocks a strictly-better craft
    swap (the gourd). Gather leaves pass the broader default that includes the
    finding axes their objective rewards.
    """
    if not isinstance(gear, dict):
        return gear

    def _rel_stats(item):
        if item is None or not hasattr(item, 'get_stats_for_skill'):
            return {}
        try:
            st = item.get_stats_for_skill(skill, location=location, character=character) or {}
        except Exception:
            return {}
        return {k: float(v) for k, v in st.items()
                if (k in more_axes or k in less_axes) and v}

    def _dominates(a_stats, b_stats):
        """True if a is >= b on every relevant axis and strictly better on >=1
        (axis absent == 0)."""
        keys = set(a_stats) | set(b_stats)
        strictly = False
        for k in keys:
            av = a_stats.get(k, 0.0)
            bv = b_stats.get(k, 0.0)
            if k in less_axes:
                av, bv = -av, -bv  # fewer is better -> flip so "more" logic holds
            if av < bv:
                return False
            if av > bv:
                strictly = True
        return strictly

    # Owned, unlocked candidates per single-occupancy gear slot.
    by_slot = {}
    for it, qty in (getattr(character, 'items', {}) or {}).items():
        if not qty or not hasattr(it, 'slot'):
            continue
        sl = getattr(it, 'slot', None)
        if sl not in _DOM_GEAR_SLOTS and not (sl == 'ring' or sl == 'rings'):
            # some data models tag both rings as slot='ring'; map to ring1/ring2
            if sl not in ('ring', 'rings'):
                continue
        if hasattr(it, 'is_unlocked'):
            try:
                if not it.is_unlocked(character, ignore_gear_requirements=True):
                    continue
            except Exception:
                pass
        for target in ((['ring1', 'ring2']) if sl in ('ring', 'rings') else [sl]):
            by_slot.setdefault(target, []).append(it)

    swapped = []
    equipped_ids = {id(gear.get(s)) for s in _DOM_GEAR_SLOTS if gear.get(s) is not None}
    for slot in _DOM_GEAR_SLOTS:
        if slot not in gear:
            continue
        cur = gear.get(slot)
        cur_stats = _rel_stats(cur)
        best = cur
        best_stats = cur_stats
        for cand in by_slot.get(slot, []):
            if cand is best:
                continue
            # Don't steal a ring already equipped in the OTHER ring slot.
            if slot in ('ring1', 'ring2') and id(cand) in equipped_ids and cand is not cur:
                continue
            cstats = _rel_stats(cand)
            if _dominates(cstats, best_stats):
                best, best_stats = cand, cstats
        if best is not cur:
            gear[slot] = best
            swapped.append(f"{slot}:{getattr(cur,'name',None)}->{getattr(best,'name',None)}")
    if swapped:
        log(f"  [ct-exact] dominance guard swapped {swapped}", session_uuid)
    return gear


# ── slot-alternatives (item upgrades) helpers ──────────────────────────────
def _resolve_alt_location(loc, act_locs):
    """Resolve a node's location for slot-alternatives scoring to a Location /
    LocationInfo OBJECT (never a bare id string).

    ``compute_slot_alternatives`` scores candidates through the heuristic
    metric functions, which read ``SELECTED_LOCATION`` as an object (region-
    scoped gear bonuses depend on it). A node's ``selected_location_id`` is
    usually a string id or None, so pass the object form: the already-resolved
    object if given, else the id resolved against the Location catalog, else the
    activity's first location (the display default)."""
    if loc is not None and hasattr(loc, 'name'):
        return loc
    if isinstance(loc, str) and loc:
        try:
            from util.autogenerated.locations import Location
            for a in dir(Location):
                if a.startswith('_'):
                    continue
                L = getattr(Location, a)
                if hasattr(L, 'name'):
                    lid = L.name.lower().replace(' ', '_').replace("'", '')
                    if lid == loc or a == loc:
                        return L
        except Exception:
            pass
    return (act_locs or [None])[0]


# Recipe-metric -> activity-metric remap, identical to the heuristic per-node
# path in crafting_tree_optimize (kept in sync so exact + heuristic score
# alternatives on the same axis).
_RECIPE_TO_ACTIVITY_METRIC = {
    'expected_steps_per_item': 'steps_per_reward_roll',
    'current_steps': 'current_steps_activity',
    'materials_per_craft': 'steps_per_reward_roll',
    'materials_for_target': 'steps_per_reward_roll',
    'total_crafts': 'steps_per_reward_roll',
    'steps_for_target': 'steps_per_reward_roll',
    'steps_for_budget': 'steps_per_reward_roll',
    'xp_per_material': 'primary_xp_per_step',
}


def _node_sorting_priority(n, ut, node_chest_target, use_fine, user_quality):
    """Build the node's sorting priority (tree list-of-lists form) exactly as the
    heuristic per-node path does, so slot-alternatives are ranked on the same
    metric axis the node was optimized for."""
    from ui.crafting_tree_optimize import _default_sorting_priority
    opt_targets = (n.get('gear_config') or {}).get('optimization_targets', []) or []
    if ut in ('activity', 'chest'):
        default_metric = 'steps_per_reward_roll'
    elif user_quality and user_quality != 'Normal':
        default_metric = 'steps_for_target'
    else:
        default_metric = 'expected_steps_per_item'
    sp = []
    for t in opt_targets:
        target_key = t.get('target', default_metric)
        if ut in ('activity', 'chest'):
            target_key = _RECIPE_TO_ACTIVITY_METRIC.get(target_key, target_key)
        sp.append([target_key, t.get('weight', 100)])
    if not sp:
        sp = _default_sorting_priority(
            default_metric, ut, node_chest_target, use_fine, user_quality)
    return sp


# ── per-node exact solve + cumulative steps/output ─────────────────────────
def _resolve_node_service(node):
    """Resolve a tree node's pinned crafting service from its
    ``selected_service_id`` (the Service enum attr name, e.g.
    ``UNDERWATER_KITCHEN_VASTALUME``). Returns the ServiceInstance, or None for
    auto (``__best__``), explicit no-service (``__none__``), unset, or unknown
    ids. Mirrors the heuristic worker's resolution so both tree paths agree."""
    sid = (node or {}).get('selected_service_id')
    if not sid or sid in ('__best__', '__none__'):
        return None
    try:
        from util.autogenerated.services import Service
    except Exception:
        return None
    svc = getattr(Service, sid, None)
    if svc is None:
        # Case-normalized fallback (parity with ui/optimize_worker's lookup).
        svc = getattr(Service, str(sid).upper().replace(' ', '_'), None)
    return svc


def _solve_node(n, kids, cum, character, session_data, global_settings, tq,
                use_fine, node_budget, helpers, log, session_uuid,
                pets_pool=None, consumables_pool=None, hidden_items=None,
                compute_alternatives=True):
    """Solve ONE node's exact gearset (leaf via target-rate, recipe via
    craft-steps with downstream M0) and set its optimized_export. Then compute
    cum[node_id] = cumulative steps to produce one output item, from the solved
    stats. Children must already be resolved (post-order). Never raises."""
    (encode_gearset, RECIPES_BY_NAME, ACTIVITIES_BY_NAME, exact_target_rate_optimize,
     exact_craft_steps_optimize, quality_prob_for, _get_gear_stats, _spa) = helpers
    nid = n['node_id']
    st = n.get('source_type')
    if st == 'bank':
        cum[nid] = 0.0
        return None
    if (n.get('gear_config') or {}).get('mode') != 'auto':
        cum[nid] = (n.get('metrics') or {}).get('steps_per_item') or 0.0
        return None
    ut = n.get('underlying_source_type') or st
    uid = n.get('underlying_source_id') or n.get('source_id')
    loc = n.get('selected_location_id')
    item = n.get('item_id') or ''
    gear = None
    node_skill = None
    # Initialized up front so the slot-alternatives block below can reference
    # them regardless of which branch ran (avoids UnboundLocalError).
    act = None
    r = None
    act_loc = None
    tgt = None
    _ct_input_obj = None
    _ct_input_meta = {}  # resolved input-item meta (bug a9002eed #5) — echoed to selected_input_items
    n_pets = n_cons = 0
    # Pinned (locked-slot) consumable / pet overlay + display metas. Computed in
    # whichever branch runs (leaf vs recipe) once node_skill + location are
    # known; the overlay is folded into the exact gear solve and the metas are
    # force-applied in the post-solve block (bug cccc3581 / 1f19d6da).
    _pin_overlay = {}
    _pin_cons_meta = None
    _pin_pet_meta = None
    t0 = time.perf_counter()
    try:
        if ut in ('activity', 'chest'):
            aid = n.get('parent_activity_id') if ut == 'chest' else uid
            act = ACTIVITIES_BY_NAME.get(aid)
            if act is not None:
                # Target must MATCH the drop-table display-name key that
                # get_expected_drop_rate emits, or the target-rate optimizer
                # gets C0=0 / no find-axis marginals and degenerates into a
                # junk (throughput/tie-break) gearset. The old
                # `ref.split('.')[-1].replace('_',' ').title()` mangling
                # produced "Ectoplasm Rock" (drop key is "Ectoplasm rock") and,
                # in fine mode, "Ectoplasm Rock Fine" (key is
                # "Ectoplasm rock (Fine)") — so gather leaves optimized the
                # WRONG objective (full Proper set for mining, Blue ice sickle
                # instead of Spectral sickle). Resolving the node's item ref to
                # the Material's canonical `.name` gives the exact key, and
                # already carries the " (Fine)" suffix for `*_FINE` refs (the
                # tree rewrites fine gather nodes to Material.X_FINE), so the
                # fine-materials toggle is finally respected on gather nodes.
                # (bug 9def5166.)
                tgt = None
                try:
                    from ui.crafting_tree import _resolve_item_ref
                    _obj = _resolve_item_ref(item)
                    if _obj is not None and getattr(_obj, 'name', None):
                        tgt = _obj.name
                except Exception:
                    tgt = None
                if not tgt:
                    # Fallbacks: the node's display name as-is (NO .title(),
                    # which corrupts sentence-cased keys), then the legacy
                    # mangle only as a last resort.
                    tgt = (n.get('item_name')
                           or (item or '').split('.')[-1].replace('_', ' ').title())
                act_loc = (getattr(act, 'locations', None) or [None])[0]
                node_skill = getattr(act, 'primary_skill', None)
                # FINE-TARGET FIX (bug 8a2a98f3): in fine mode a gather leaf must
                # optimize for the FINE drop, exactly like the heuristic path
                # (which defaults the leaf target to 'cat:fine') and the goals-
                # report steps/target-item path. The comment above assumed the
                # tree always rewrites fine gather nodes to Material.X_FINE, but
                # that is NOT true when a base material (e.g. Material.ECTOPLASM_
                # ROCK) feeds a fine-capable recipe (Smelt into ectoplasm): the
                # node stays the base ref, so `tgt` resolved to the NON-fine key
                # ("Ectoplasm rock") and the exact leaf optimized the wrong
                # objective — FMF gear/pet looked useless and got dropped, giving
                # ~1072 steps/fine-item vs the heuristic's ~896.
                tgt, _is_fine_target = _fine_leaf_target(
                    item, tgt, use_fine, act, character, loc or act_loc)
                _pets = _filter_pool(pets_pool, node_skill, 'pet', is_recipe=False)
                _cons = _filter_pool(consumables_pool, node_skill, 'consumable', is_recipe=False)
                n_pets, n_cons = len(_pets), len(_cons)
                # Resolve the activity's input item (arrows, etc.) so the exact
                # leaf optimizer accounts for it — mirrors the heuristic per-node
                # path (crafting_tree_optimize.py). Without this the exact
                # whole-tree solve ran input-required hunting activities with no
                # input, so no input was ever selected (bug a9002eed #5).
                _ct_input_obj = None
                try:
                    if getattr(act, 'input_items', None):
                        from ui.crafting_tree_optimize import _auto_pick_input_items_for_activity
                        from ui.optimize_worker import _resolve_input_items_for_activity
                        _gcfg = n.get('gear_config') or {}
                        _user_inputs = _gcfg.get('user_input_items') or {}
                        _user_by_idx = {int(k): v for k, v in _user_inputs.items() if v is not None}
                        _picked = _auto_pick_input_items_for_activity(
                            act, session_data, node_skill or '') or {}
                        _merged = dict(_picked)
                        _merged.update(_user_by_idx)
                        if _merged:
                            _pin_fine = any(
                                isinstance(v, dict) and (v.get('is_fine')
                                    or str(v.get('name', '')).endswith('(Fine)'))
                                for v in _merged.values())
                            _use_fi = bool(global_settings.get('use_fine_inputs', False)) or _pin_fine
                            _raw = {str(k): v for k, v in _merged.items()}
                            _ct_input_obj = _resolve_input_items_for_activity(_raw, act, _use_fi)
                            # Reflect the fine identity in the echoed meta so the
                            # slot renders the Fine variant (name/rarity/is_fine).
                            if _ct_input_obj is not None and str(getattr(_ct_input_obj, 'name', '')).endswith('(Fine)'):
                                for _v in _raw.values():
                                    if isinstance(_v, dict):
                                        _v['is_fine'] = True
                                        _v['name'] = getattr(_ct_input_obj, 'name', _v.get('name'))
                                        _v['rarity'] = 'fine'
                            _ct_input_meta = _raw
                except Exception as _ie:  # noqa: BLE001
                    log(f"  [ct-exact] input resolve failed for {nid}: {_ie!r}", session_uuid)
                # Fine targets factorize as base_rate*(1+FMF); the linear A_coins
                # model in exact_target_rate_optimize drops the base_find x FMF
                # cross-term (~11% error), so it mis-ranks FMF gear. The goals-
                # report steps/target-item path routes fine targets to the
                # multiplicative ExactFineRateOptimizer (proven 0.00% model
                # error) — mirror that here so tree/heuristic/goals-report agree.
                _leaf_opt = exact_target_rate_optimize
                if _is_fine_target:
                    try:
                        from util.exact_target_rate_optimizer import (
                            exact_fine_rate_optimize as _leaf_opt)
                    except Exception:
                        _leaf_opt = exact_target_rate_optimize
                # Pinned consumable/pet: fold their stats into the gear solve and
                # suppress the engine's own pool pick for the pinned slot so it
                # can't swap in a different one (bug cccc3581 / 1f19d6da).
                _pin_overlay, _pc_obj, _pin_cons_meta, _pp_obj, _pin_pet_meta = \
                    _pinned_overlay_and_meta(n, node_skill, loc or act_loc,
                                             character, session_data, log, session_uuid)
                if _pc_obj is not None:
                    _cons = []
                if _pp_obj is not None:
                    _pets = []
                gear = _leaf_opt(
                    act, character, tgt, skill=node_skill,
                    location=loc or act_loc, pets=_pets, consumables=_cons,
                    input_item=_ct_input_obj, base_stats=_pin_overlay or None)
                if gear:
                    gear = _dominance_swap_gear(
                        gear, node_skill, loc or act_loc, character, log, session_uuid)
        elif ut == 'recipe':
            r = RECIPES_BY_NAME.get(uid)
            if r is not None:
                node_skill = r.skill
                m0 = 0.0
                for c in kids.get(nid, []):
                    m0 += _material_req_for_child(r, c.get('item_id'), c) * cum.get(c['node_id'], 0.0)
                slvl = character.get_skill_level((r.skill or '').lower())
                lbq = max(0, slvl - (r.level or 0))
                apply_q = (bool(n.get('_lp_is_root') or n.get('parent_id') in (None, ''))
                           and tq != 'Normal' and item.startswith('Item.'))
                _pets = _filter_pool(pets_pool, node_skill, 'pet', is_recipe=True)
                _cons = _filter_pool(consumables_pool, node_skill, 'consumable', is_recipe=True)
                n_pets, n_cons = len(_pets), len(_cons)
                # Resolve the node's pinned crafting service (if any) so the
                # exact solve honours it. Without this the exact recipe path
                # ignored the service entirely: an underwater kitchen's
                # 'diving gear': 3 requirement was never enforced, so overriding
                # a recipe to an underwater service produced a gearset missing
                # the required diving pieces (bug c1ab7499). When the node has a
                # pinned service but no explicit location, fall back to the
                # service's own location so gear is scored in the right region.
                _svc = _resolve_node_service(n)
                _rec_loc = loc
                if _rec_loc is None and _svc is not None and getattr(_svc, 'location', None) is not None:
                    _rec_loc = _svc.location
                # Pinned consumable/pet: fold stats into the gear solve and
                # suppress the engine's pool pick for the pinned slot (bug
                # cccc3581 / 1f19d6da). Overlay restores the correct QO/DR
                # baseline the objective divides by, so a close back-slot swap
                # (gourd vs bandolier) is decided on real stats and the displayed
                # QO stops flickering 242<->237.
                _pin_overlay, _pc_obj, _pin_cons_meta, _pp_obj, _pin_pet_meta = \
                    _pinned_overlay_and_meta(n, node_skill, _rec_loc,
                                             character, session_data, log, session_uuid)
                if _pc_obj is not None:
                    _cons = []
                if _pp_obj is not None:
                    _pets = []
                gear = exact_craft_steps_optimize(
                    r, character, skill=r.skill, location=_rec_loc,
                    output_qty=r.quantity or 1, if_bonus=0.0, m0=m0,
                    recipe_level=r.level, level_bonus_qo=lbq, target_quality=tq,
                    use_fine=use_fine, has_equipment_input=False,
                    apply_quality=apply_q, node_budget=node_budget,
                    pets=_pets, consumables=_cons, service=_svc,
                    base_stats_extra=_pin_overlay or None)
                if gear:
                    gear = _dominance_swap_gear(
                        gear, node_skill, _rec_loc, character, log, session_uuid,
                        more_axes=_DOM_CRAFT_MORE, less_axes=_DOM_LESS_IS_BETTER)
    except Exception as e:  # noqa: BLE001 — never crash the whole optimize
        log(f"  [ct-exact] node {nid} ({ut}) solve failed: {e!r}", session_uuid)
        gear = None
    dt = time.perf_counter() - t0
    if gear:
        gc = n.setdefault('gear_config', {})
        gc['optimized_export'] = encode_gearset(gear)
        gc['optimized_stats'] = None
        # Echo the resolved input item so the node's slot shows the selected
        # input (and its Fine identity) — the exact path previously left it
        # empty (bug a9002eed #5).
        if _ct_input_meta:
            gc['selected_input_items'] = _ct_input_meta
        # Persist the exact optimizer's chosen pet + consumable. encode_gearset()
        # CANNOT serialize the 'pet'/'consumable' slots (Gearset has no _pet/
        # _consumable attrs), and ui.crafting_tree._get_gear_stats only folds
        # their stats back into the node metric when they're on
        # gc['optimized_pet'] / gc['optimized_consumable'] (the same overlay path
        # locked_slots uses). Without persisting them here the exact gather
        # gearsets silently DROPPED their optimizer-picked pet + consumable — a
        # large fine_material_finding / double_rewards / double_action boost — so
        # they displayed markedly less efficient than the heuristic column-3
        # optimizer, which DOES persist them (see crafting_tree_optimize.py). (bug
        # 777ab287.)
        #
        # TREE-CONSISTENT SELECTION: the exact engine values a candidate
        # pet/consumable through its own axis model, which can diverge from the
        # tree's authoritative per-node metric (notably charge-based pets whose
        # ability the metric doesn't credit as always-on). So we don't trust the
        # engine's pick blindly — we score the four subsets (none / pet /
        # consumable / both) with the SAME calculate_node_metrics the display
        # uses (for a leaf this is exactly what calculate_tree computes) and keep
        # the subset that minimizes the node's true steps_per_item. Guarantees
        # the node is never worse than dropping them, and captures the (usually
        # large) gain when the pick genuinely helps.
        _pet_meta = None
        _pet_obj = gear.get('pet')
        if _pet_obj is not None:
            _pname = getattr(_pet_obj, 'name', '') or ''
            _pet_meta = {
                'itemId': _pname.lower().replace(' ', '_'), 'name': _pname,
                'level': int(getattr(_pet_obj, 'level', 0) or 0),
                'variant': getattr(_pet_obj, 'variant', None) or 'normal',
                'rarity': 'common', 'type': 'pet',
            }
        _cons_meta = None
        _cons_obj = gear.get('consumable')
        if _cons_obj is not None:
            _cname = getattr(_cons_obj, 'name', '') or ''
            _base = _cname.replace(' (Fine)', '').replace('(Fine)', '').strip()
            _cid = (_base.lower().replace(' ', '_').replace('(', '')
                    .replace(')', '').replace('-', '_').replace("'", ''))
            _cons_meta = {
                'itemId': _cid, 'name': _cname,
                'is_fine': _cname.endswith('(Fine)') or _cname.endswith(' (Fine)'),
                'rarity': 'common', 'type': 'consumable',
            }
        if _pet_meta or _cons_meta:
            try:
                from ui.crafting_tree import (calculate_node_metrics as _cnm,
                                              _load_game_data as _ld_gd)
                _gd = _ld_gd()
                _is_root = bool(n.get('_lp_is_root') or n.get('parent_id') in (None, ''))
                _kid_nodes = kids.get(nid, [])

                def _spi(pm, cm):
                    gc['optimized_pet'] = pm
                    gc['optimized_consumable'] = cm
                    try:
                        _m = _cnm(n, _kid_nodes, [], _gd, session_data,
                                  global_settings, is_root=_is_root)
                        _v = _m.get('steps_per_item')
                        return _v if (_v and _v != float('inf')) else float('inf')
                    except Exception:
                        return float('inf')

                _best_pm, _best_cm, _best_v = None, None, _spi(None, None)
                for _pm in ([_pet_meta, None] if _pet_meta else [None]):
                    for _cm in ([_cons_meta, None] if _cons_meta else [None]):
                        if _pm is None and _cm is None:
                            continue
                        _v = _spi(_pm, _cm)
                        if _v < _best_v:
                            _best_pm, _best_cm, _best_v = _pm, _cm, _v
                gc['optimized_pet'] = _best_pm
                gc['optimized_consumable'] = _best_cm
            except Exception:
                gc['optimized_pet'] = _pet_meta
                gc['optimized_consumable'] = _cons_meta
        else:
            gc['optimized_pet'] = None
            gc['optimized_consumable'] = None
        # Pinned (locked-slot) consumable / pet are a hard user choice — force
        # them into the solved node regardless of the subset scoring above (the
        # engine's pool for the pinned slot was emptied, so it never picked one).
        # Their stats were already folded into the gear solve via _pin_overlay,
        # so this just makes the displayed slot + metric match the pin (bug
        # cccc3581 / 1f19d6da).
        if _pin_cons_meta is not None:
            gc['optimized_consumable'] = _pin_cons_meta
        if _pin_pet_meta is not None:
            gc['optimized_pet'] = _pin_pet_meta
        # Slot alternatives (item upgrades) for the tree-node slot popup. The
        # exact path previously never populated gc['slot_alternatives'], so the
        # popup showed no item upgrades under the exact optimizer (only the
        # heuristic per-node worker computed them). Mirror that here by scoring
        # non-owned / owned-but-locked / hidden upgrades for the solved gearset
        # via the shared compute_tree_node_slot_alternatives wrapper (which sets
        # up the optimizer module globals the scorer reads). Best-effort — never
        # let an alternatives failure break the solve; always set the field
        # (even to an empty wrapper) so the popup distinguishes "computed, none"
        # from "never computed".
        if compute_alternatives:
            try:
                from ui.optimize_worker import compute_tree_node_slot_alternatives
                _uq = global_settings.get('target_quality', 'Normal')
                if ut in ('activity', 'chest') and act is not None:
                    _chest_tgt = None
                    if ut == 'chest':
                        try:
                            from ui.crafting_tree_optimize import _chest_target_name_for_node
                            _chest_tgt = _chest_target_name_for_node(n)
                        except Exception:
                            _chest_tgt = None
                    _sp = _node_sorting_priority(n, ut, _chest_tgt, use_fine, _uq)
                    _alt_loc = _resolve_alt_location(
                        loc, getattr(act, 'locations', None) or [act_loc])
                    _alts, _locked, _hidden = compute_tree_node_slot_alternatives(
                        gear, character, 'activity', activity=act,
                        location=_alt_loc, input_item=_ct_input_obj,
                        sorting_priority=_sp, consumable=gear.get('consumable'),
                        hidden_items=hidden_items,
                        use_fine_inputs=bool(global_settings.get('use_fine_inputs', False)))
                    gc['slot_alternatives'] = {
                        'alternatives': _alts or {},
                        'locked_alternatives': _locked or {},
                        'hidden_alternatives': _hidden or {},
                    }
                elif ut == 'recipe' and r is not None:
                    _sp = _node_sorting_priority(n, ut, None, use_fine, _uq)
                    _alt_loc = _resolve_alt_location(loc, [None])
                    _alts, _locked, _hidden = compute_tree_node_slot_alternatives(
                        gear, character, 'recipe', recipe=r, service=None,
                        location=_alt_loc, sorting_priority=_sp, target_quality=tq,
                        consumable=gear.get('consumable'), hidden_items=hidden_items)
                    gc['slot_alternatives'] = {
                        'alternatives': _alts or {},
                        'locked_alternatives': _locked or {},
                        'hidden_alternatives': _hidden or {},
                    }
                _sa = gc.get('slot_alternatives') or {}
                log(f"  [ct-exact] node {nid} slot_alternatives: "
                    f"{sum(len(v) for v in (_sa.get('alternatives') or {}).values())} non-owned, "
                    f"{sum(len(v) for v in (_sa.get('locked_alternatives') or {}).values())} locked",
                    session_uuid)
            except Exception as _alt_err:  # noqa: BLE001 — never break the solve
                log(f"  [ct-exact] node {nid} slot_alternatives failed: {_alt_err!r}",
                    session_uuid)
    slots_filled = sum(1 for v in (gear or {}).values() if v)
    tool_slots_used = sum(1 for s, v in (gear or {}).items()
                          if v and str(s).startswith('tool'))
    has_pet = any(str(s) == 'pet' and v for s, v in (gear or {}).items())
    has_cons = any(str(s) in ('consumable', 'consumable1') and v
                   for s, v in (gear or {}).items())
    # Trace line: surfaces tool-slot count, pet/consumable inclusion, and the
    # fine flag per node. Leaf (activity/chest) nodes now target the fine
    # material's canonical drop-name (Material.X_FINE -> "X (Fine)") when the
    # tree is in fine mode, so the target-rate objective is fine-aware (bug
    # 9def5166 fixed); recipe nodes pass use_fine into the craft-steps solve.
    log(f"  [ct-exact] node {nid} {ut}:{uid} item={item} skill={node_skill} "
        f"tool_slots_avail={character.get_tool_slots()} tools_used={tool_slots_used} "
        f"slots_filled={slots_filled} pets_pool={n_pets} pet_used={has_pet} "
        f"cons_pool={n_cons} cons_used={has_cons} "
        f"use_fine={use_fine} "
        f"t={dt:.2f}s", session_uuid)
    cum[nid] = _node_cumulative_steps(
        n, ut, uid, kids.get(nid, []), cum, character, session_data,
        global_settings, tq, use_fine, _get_gear_stats, _spa, quality_prob_for,
        RECIPES_BY_NAME)
    return {'node_id': nid, 'item': item, 'kind': ut, 'source': uid,
            'seconds': round(dt, 3),
            'slots_filled': slots_filled, 'tools_used': tool_slots_used,
            'pet_used': has_pet, 'cons_used': has_cons,
            'cum_steps_per_item': cum[nid]}


def _run_bottom_up(nodes, character, session_data, global_settings, node_budget,
                   helpers, log, session_uuid, scope_ids=None,
                   pets_pool=None, consumables_pool=None, hidden_items=None,
                   compute_alternatives=True, cum_seed=None):
    """Solve every eligible node in `nodes` (optionally restricted to scope_ids)
    bottom-up. Returns (cum dict, list of per-node diagnostics).

    cum_seed pre-populates the cumulative steps of nodes outside scope_ids, so
    a scoped re-solve can reuse already-solved children."""
    tq = global_settings.get('target_quality', 'Normal')
    use_fine = bool(global_settings.get('use_fine'))
    kids = {}
    for n in nodes:
        pid = n.get('parent_id')
        if pid:
            kids.setdefault(pid, []).append(n)
    order = sorted(nodes, key=lambda n: -(n.get('depth') or 0))  # deepest first
    cum = dict(cum_seed or {})
    per_node = []
    for n in order:
        if scope_ids is not None and n['node_id'] not in scope_ids:
            continue
        d = _solve_node(n, kids, cum, character, session_data, global_settings,
                        tq, use_fine, node_budget, helpers, log, session_uuid,
                        pets_pool=pets_pool, consumables_pool=consumables_pool,
                        hidden_items=hidden_items,
                        compute_alternatives=compute_alternatives)
        if d:
            per_node.append(d)
    return cum, per_node


# ── Phase 0: exact Best(auto) route re-resolution ──────────────────────────
def _resolve_best_routes_exact(nodes, global_settings, session_data, character,
                               game_data, node_budget, helpers, log, session_uuid,
                               pets_pool=None, consumables_pool=None):
    """For each route-ambiguous Best(auto) node (deepest-first), solve each
    candidate source subtree exactly and keep the one with the lowest cumulative
    steps/target; splice it into the live tree. Returns a list of resolutions."""
    from ui.crafting_tree import (route_candidates, on_source_change,
                                  descendant_ids, _best_auto_children_ambiguous,
                                  _check_node_requirement_status)
    skip_shops = global_settings.get('skip_shops', True)
    skip_chests = global_settings.get('skip_chests', True)
    spoiler = global_settings.get('spoiler_protection', False)
    best_nodes = [n for n in nodes
                  if n.get('source_type') == 'best'
                  and (n.get('gear_config') or {}).get('mode') == 'auto'
                  and _best_auto_children_ambiguous(n.get('available_sources') or [])]
    best_nodes.sort(key=lambda n: -(n.get('depth') or 0))
    resolutions = []
    for bn in best_nodes:
        bid = bn['node_id']
        cands = _cap_route_candidates(
            route_candidates(bn.get('available_sources') or [],
                             skip_shops=skip_shops, skip_chests=skip_chests))
        if not cands:
            continue
        if len(cands) == 1:
            try:
                nodes[:] = on_source_change(nodes, bid, cands[0], game_data, session_data, spoiler)
            except Exception as e:  # noqa: BLE001
                log(f"  [ct-exact-route] single-cand splice failed {bid}: {e!r}", session_uuid)
            continue
        best_spi = float('inf')
        best_cand = None
        for cand in cands:
            try:
                trial = on_source_change(copy.deepcopy(nodes), bid, cand,
                                         game_data, session_data, spoiler)
            except Exception as e:  # noqa: BLE001
                log(f"  [ct-exact-route] on_source_change failed {bid} "
                    f"{cand.get('type')}:{cand.get('source_id')}: {e!r}", session_uuid)
                continue
            sub_ids = descendant_ids(trial, bid) | {bid}
            try:
                cum, _ = _run_bottom_up(trial, character, session_data, global_settings,
                                        node_budget, helpers, log, session_uuid,
                                        scope_ids=sub_ids,
                                        pets_pool=pets_pool, consumables_pool=consumables_pool,
                                        compute_alternatives=False)
                spi = cum.get(bid, float('inf'))
            except Exception as e:  # noqa: BLE001
                log(f"  [ct-exact-route] trial solve failed {bid} "
                    f"{cand.get('type')}:{cand.get('source_id')}: {e!r}", session_uuid)
                continue
            # Feasibility gate (report 65a22653): exclude a candidate route the
            # character CAN'T actually perform. The exact leaf optimizer only
            # filters tool keyword-level requirements — it does NOT exclude an
            # activity/recipe gated by the character's own SKILL LEVEL (e.g.
            # "Ectoplasm fishing" needs Fishing 55). Without this gate a
            # cheaper-looking but infeasible recipe route wins over the ONLY
            # feasible one (e.g. Ghost tag, the sole route the player is leveled
            # for). Mirror the heuristic router's requirement_warning gate: if
            # any node in this route's subtree fails a requirement, treat the
            # route as infeasible and skip it.
            _infeasible_reason = None
            try:
                for _sn in trial:
                    if _sn.get('node_id') not in sub_ids:
                        continue
                    _rw = _check_node_requirement_status(_sn, session_data, game_data)
                    if _rw:
                        _infeasible_reason = _rw
                        break
            except Exception:
                _infeasible_reason = None
            if _infeasible_reason:
                log(f"  [ct-exact-route] {bn.get('item_id')} via "
                    f"{cand.get('type')}:{cand.get('source_id')} INFEASIBLE "
                    f"({_infeasible_reason}) -> skipped", session_uuid)
                continue
            log(f"  [ct-exact-route] {bn.get('item_id')} via "
                f"{cand.get('type')}:{cand.get('source_id')} -> steps/item={spi:.1f}", session_uuid)
            if spi < best_spi:
                best_spi = spi
                best_cand = cand
        if best_cand is not None:
            try:
                nodes[:] = on_source_change(nodes, bid, best_cand, game_data, session_data, spoiler)
                resolutions.append({'node_id': bid, 'item': bn.get('item_id'),
                                    'chosen': f"{best_cand.get('type')}:{best_cand.get('source_id')}",
                                    'steps_per_item': best_spi})
                log(f"  [ct-exact-route] {bn.get('item_id')}: chose "
                    f"{best_cand.get('type')}:{best_cand.get('source_id')} "
                    f"(steps/item={best_spi:.1f})", session_uuid)
            except Exception as e:  # noqa: BLE001
                log(f"  [ct-exact-route] final splice failed {bid}: {e!r}", session_uuid)
    return resolutions


# ── entry point ─────────────────────────────────────────────────────────────
def _exact_solve_context(session_uuid, global_settings, session_data, ui_config, log):
    """Shared per-solve setup: optimizer helpers, reconstructed character, game
    data, pet/consumable pools and the hidden-items set."""
    from ui.crafting_tree import (_get_gear_stats, _calculate_steps_per_action,
                                  _load_game_data)
    from util.gearset_utils import encode_gearset
    from util.autogenerated.recipes import RECIPES_BY_NAME
    from util.autogenerated.activities import ACTIVITIES_BY_NAME
    from util.exact_target_rate_optimizer import exact_target_rate_optimize
    from util.exact_craft_steps_optimizer import exact_craft_steps_optimize, quality_prob_for

    helpers = (encode_gearset, RECIPES_BY_NAME, ACTIVITIES_BY_NAME,
               exact_target_rate_optimize, exact_craft_steps_optimize,
               quality_prob_for, _get_gear_stats, _calculate_steps_per_action)
    _cc = session_data if isinstance(session_data, dict) else {}
    character = _build_character_from_config(_cc, ui_config)
    game_data = _load_game_data()
    # Force the item pool to build so consumable detection (items with a
    # `duration` attr) has something to scan.
    try:
        _ = character.items
    except Exception:
        pass
    pets_pool, consumables_pool = _build_gear_pools(
        character, _cc, ui_config, global_settings, log, session_uuid)

    # Hidden-items set for slot-alternatives bucketing (mirrors the heuristic
    # worker). Best-effort — an empty set just means nothing is treated as
    # hidden in the alternatives popup.
    hidden_items = set()
    try:
        from ui.optimize_worker import build_hidden_items_set
        hidden_items = build_hidden_items_set(ui_config or {}) or set()
    except Exception as _hi_err:  # noqa: BLE001
        log(f"  [ct-exact] hidden-items set build failed: {_hi_err!r}", session_uuid)
        hidden_items = set()
    return helpers, character, game_data, pets_pool, consumables_pool, hidden_items


def optimize_tree_exact(session_uuid, nodes, global_settings, session_data,
                        ui_config=None, *, node_budget=400_000, log=None,
                        return_cum=False, compute_alternatives=True,
                        scope_ids=None, cum_seed=None):
    """Solve every eligible node's gearset (with exact Best(auto) route
    re-resolution) bottom-up. Mutates nodes' gear_config.optimized_export.
    Returns a diagnostics dict. Never raises.

    return_cum=True adds 'cum' (node_id -> cumulative steps per output item) to
    the diagnostics, for seeding optimize_root_only. compute_alternatives=False
    skips the slot-alternatives popup data (it never affects gearsets or cum).

    scope_ids/cum_seed enable CROSS-ITEM reuse: when scope_ids is given, only
    those nodes are solved and cum_seed pre-populates the cumulative steps of
    the out-of-scope nodes (already-solved crafted sub-inputs transplanted from
    a prior standalone solve). Route re-resolution is skipped in that case — the
    caller guarantees the out-of-scope subtrees are already resolved + solved."""
    if log is None:
        def log(*a, **k):
            pass
    (helpers, character, game_data, pets_pool, consumables_pool,
     hidden_items) = _exact_solve_context(session_uuid, global_settings,
                                          session_data, ui_config, log)

    t_all = time.perf_counter()
    resolutions = []
    if scope_ids is None:
        resolutions = _resolve_best_routes_exact(
            nodes, global_settings, session_data, character, game_data, node_budget,
            helpers, log, session_uuid,
            pets_pool=pets_pool, consumables_pool=consumables_pool)
    cum, per_node = _run_bottom_up(
        nodes, character, session_data, global_settings, node_budget, helpers,
        log, session_uuid, scope_ids=scope_ids, cum_seed=cum_seed,
        pets_pool=pets_pool, consumables_pool=consumables_pool,
        hidden_items=hidden_items, compute_alternatives=compute_alternatives)
    diag = {'per_node': per_node, 'routes_resolved': resolutions,
            'wall_time': round(time.perf_counter() - t_all, 3)}
    if return_cum:
        diag['cum'] = cum
    return diag


def optimize_root_only(session_uuid, nodes, global_settings, session_data,
                       ui_config=None, cum_seed=None, *, node_budget=400_000,
                       log=None, compute_alternatives=True):
    """Re-solve ONLY the root node of an already-solved tree, reusing the
    children's cumulative steps from cum_seed (the 'cum' of a prior
    optimize_tree_exact(..., return_cum=True) on the same nodes).

    Valid when only root-scoped settings changed (target_quality): non-root
    nodes never activate the quality axis, so their gearsets and cumulative
    steps are quality-invariant. Route re-resolution is NOT re-run, so the
    caller must not use this when the root itself was a route-ambiguous
    Best(auto) node.

    Mutates the root's gear_config. Returns the updated cum, or None if there
    is no root, a child is missing from cum_seed, or the root solve produced no
    gearset (the root's prior optimized_export is cleared first so a failed
    solve can never leave a stale gearset behind)."""
    if log is None:
        def log(*a, **k):
            pass
    root = next((n for n in nodes if n.get('parent_id') in (None, '')), None)
    if root is None:
        return None
    root_id = root.get('node_id')
    seed = dict(cum_seed or {})
    child_ids = [n.get('node_id') for n in nodes if n.get('parent_id') == root_id]
    if any(cid not in seed for cid in child_ids):
        return None
    (helpers, character, _game_data, pets_pool, consumables_pool,
     hidden_items) = _exact_solve_context(session_uuid, global_settings,
                                          session_data, ui_config, log)
    gc = root.setdefault('gear_config', {})
    gc.pop('optimized_export', None)
    seed.pop(root_id, None)
    cum, _per_node = _run_bottom_up(
        nodes, character, session_data, global_settings, node_budget, helpers,
        log, session_uuid, scope_ids={root_id},
        pets_pool=pets_pool, consumables_pool=consumables_pool,
        hidden_items=hidden_items, compute_alternatives=compute_alternatives,
        cum_seed=seed)
    if not gc.get('optimized_export'):
        return None
    return cum


def _node_cumulative_steps(n, ut, uid, children, cum, character, session_data,
                           global_settings, tq, use_fine, _get_gear_stats,
                           _spa, quality_prob_for, RECIPES_BY_NAME):
    """Cumulative steps to produce ONE output item of node n, from the solved
    gearset stats (matches ui/crafting_tree.calculate_node_metrics)."""
    try:
        gc = n.get('gear_config') or {}
        stats = _get_gear_stats(n, session_data, None) if gc.get('optimized_export') else {}
    except Exception:
        stats = {}
    if ut in ('activity', 'chest'):
        # Leaf: steps/target for the SOLVED gearset. Must be computed from the
        # tree's own metric (node['metrics'] is stale inside route trials, which
        # made every candidate tie at 0 and route selection arbitrary).
        try:
            from ui.crafting_tree import calculate_node_metrics as _cnm, _load_game_data as _ld
            m = _cnm(n, [], [], _ld(), session_data, global_settings, is_root=False)
            spi = m.get('steps_per_item')
            if spi not in (None, float('inf')):
                return float(spi)
        except Exception:
            pass
        spi = (n.get('metrics') or {}).get('steps_per_item')
        return float(spi) if spi not in (None, float('inf')) else 0.0
    r = RECIPES_BY_NAME.get(uid)
    if r is None:
        return 0.0
    DA = min(1.0, stats.get('double_action', 0.0)); DR = min(1.0, stats.get('double_rewards', 0.0))
    NMC = min(0.99, stats.get('no_materials_consumed', 0.0)); WE = stats.get('work_efficiency', 0.0)
    QO = stats.get('quality_outcome', 0.0); flat = int(stats.get('steps_add', 0)); pct = stats.get('steps_percent', 0.0)
    oq = r.quantity or 1
    slvl = character.get_skill_level((r.skill or '').lower())
    item = n.get('item_id') or ''
    apply_q = (bool(n.get('_lp_is_root') or n.get('parent_id') in (None, ''))
               and tq != 'Normal' and item.startswith('Item.'))
    qp = quality_prob_for(r.level, QO + max(0, slvl - (r.level or 0)), tq, use_fine=use_fine) if apply_q else 1.0
    spa = _spa(r.base_steps, r.max_efficiency, slvl, r.level, WE, flat, pct)
    local = spa / (oq * (1.0 + DA) * (1.0 + DR) * qp)
    downstream = 0.0
    for c in children:
        req = _material_req_for_child(r, c.get('item_id'), c)
        ir = req * (1.0 - NMC) / (oq * (1.0 + DR) * qp)
        downstream += ir * cum.get(c['node_id'], 0.0)
    return local + downstream
