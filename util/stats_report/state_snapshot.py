"""state_snapshot — CharacterStateSnapshot dataclass.

Single source of truth for every character-state input that affects
stale detection. Adding a new game state dimension means adding a field
here AND updating compute_effective_owned_bitmap or compute_metric_inputs_hash.
Nothing else.
"""

import hashlib
import json
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Dict, FrozenSet, Mapping, Tuple

GATHERING_SKILLS = ("fishing", "foraging", "hunting", "mining", "woodcutting")
ARTISAN_SKILLS = ("carpentry", "cooking", "crafting", "smithing", "tailoring", "trinketry")
UTILITY_SKILLS = ("agility",)


@dataclass(frozen=True)
class CharacterStateSnapshot:
    """Immutable snapshot of every character-state input that affects
    Effective_Owned_Bitmap or metric_inputs_hash."""

    # Inventory — visibility-applied at construction time
    owned_items: FrozenSet[Tuple[str, str]]            # (slug, quality) pairs visible
    ring_quantities: Mapping[Tuple[str, str], int]     # (slug, quality) -> count of visible instances
    hidden_items: FrozenSet[str]                        # whole-item hide
    hidden_consumables_fine: FrozenSet[str]             # consumable Fine variant hide

    # Per-item conditional state
    custom_stats: Mapping[str, bool]                    # UI toggles for activity_completion gates

    # Skill / progression (raw XP — levels derived)
    skills_xp: Mapping[str, int]

    # Reputations / unlocks
    reputation: Mapping[str, int]
    achievement_points: int

    # Misc state
    coins: int
    steps: int

    # 2026-06-16 (jwbail): owned pets as (species_lower, level) so adding a pet
    # or leveling one flips the snapshot (was previously invisible to stale
    # detection — pets aren't in owned_items or the dominance bitmap). Defaulted
    # so older callers / cached JSON without the field still construct.
    owned_pets: FrozenSet[Tuple[str, int]] = field(default_factory=frozenset)

    # 2026-06-19 (jwbail): owned collectible slugs. Collectibles are NOT in
    # owned_items (they aren't gear / aren't in the dominance bitmap), so
    # new-items "owned" detection had no way to see them. enumerate_applicable_
    # sources._kinds_with_unowned_drops therefore treated every owned
    # collectible as still-unowned and surfaced its activity's "collectibles"
    # scope as REASON_NEWLY_UNLOCKED forever (the worker's build_new_items_jobs
    # correctly skips owned collectibles via ownership['collectibles'], so no
    # result row is ever written and the (!) never clears). Mirror the worker's
    # ownership['collectibles'] set here. Defaulted so older cached JSON without
    # the field still constructs.
    owned_collectibles: FrozenSet[str] = field(default_factory=frozenset)

    def __post_init__(self):
        # Convert mutable mappings to immutable views
        for fname in ("custom_stats", "skills_xp", "reputation", "ring_quantities"):
            v = getattr(self, fname)
            if not isinstance(v, MappingProxyType):
                object.__setattr__(self, fname, MappingProxyType(dict(v)))

    # ── Derived properties ─────────────────────────────────────────────────

    @property
    def skill_levels(self) -> Dict[str, int]:
        # Memoized: derived purely from the immutable skills_xp mapping. On a
        # populated character a single stale-check calls this >100k times
        # (compute_effective_owned_bitmap -> _check_unlock -> skill_levels, per
        # owned item per result-row scope), and the xp_to_level dictcomp was
        # re-run every time. Cache on the (frozen) instance via the same
        # object.__setattr__ escape hatch __post_init__ uses. The cache is a
        # NON-field attribute, so it never participates in __eq__/__hash__ and
        # therefore cannot affect the prev != curr staleness gate.
        cached = self.__dict__.get('_skill_levels_cache')
        if cached is not None:
            return cached
        try:
            from util.walkscape_constants import xp_to_level
        except ImportError:
            return {s: 1 for s in self.skills_xp}
        out = {s.lower(): xp_to_level(xp) for s, xp in self.skills_xp.items()}
        object.__setattr__(self, '_skill_levels_cache', out)
        return out

    @property
    def total_skill_level(self) -> int:
        return sum(self.skill_levels.values())

    @property
    def character_level(self) -> int:
        try:
            from util.walkscape_constants import character_level_from_steps
            return 1 + character_level_from_steps(self.steps)
        except ImportError:
            return 1

    def category_total_pct(self, category: str) -> float:
        skills_map = {"gathering": GATHERING_SKILLS, "artisan": ARTISAN_SKILLS, "utility": UTILITY_SKILLS}
        skills = skills_map.get(category.lower(), ())
        if not skills:
            return 0.0
        levels = self.skill_levels
        total = sum(levels.get(s, 1) for s in skills)
        return total / (len(skills) * 99) * 100

    # ── Hash for caching ──────────────────────────────────────────────────

    def stable_tuple(self):
        return (
            tuple(sorted(self.owned_items)),
            tuple(sorted(self.ring_quantities.items())),
            tuple(sorted(self.hidden_items)),
            tuple(sorted(self.hidden_consumables_fine)),
            tuple(sorted(self.custom_stats.items())),
            tuple(sorted(self.skills_xp.items())),
            tuple(sorted(self.reputation.items())),
            self.achievement_points,
            self.coins,
            self.steps,
            tuple(sorted(self.owned_pets)),
            tuple(sorted(self.owned_collectibles)),
        )

    def __hash__(self):
        return hash(self.stable_tuple())

    def to_json(self) -> str:
        """Serialize for storage in character_state_snapshot_cache."""
        d = {
            "owned_items": [list(t) for t in sorted(self.owned_items)],
            "ring_quantities": [[list(k), v] for k, v in sorted(self.ring_quantities.items())],
            "hidden_items": sorted(self.hidden_items),
            "hidden_consumables_fine": sorted(self.hidden_consumables_fine),
            "custom_stats": dict(sorted(self.custom_stats.items())),
            "skills_xp": dict(sorted(self.skills_xp.items())),
            "reputation": dict(sorted(self.reputation.items())),
            "achievement_points": self.achievement_points,
            "coins": self.coins,
            "steps": self.steps,
            "owned_pets": [list(t) for t in sorted(self.owned_pets)],
            "owned_collectibles": sorted(self.owned_collectibles),
        }
        return json.dumps(d, sort_keys=True)

    @classmethod
    def from_json(cls, s: str) -> "CharacterStateSnapshot":
        d = json.loads(s)
        ring_q_raw = d.get("ring_quantities") or []
        ring_quantities = {}
        for entry in ring_q_raw:
            try:
                key, val = entry
                ring_quantities[tuple(key)] = int(val)
            except (TypeError, ValueError):
                continue
        return cls(
            owned_items=frozenset((a, b) for a, b in d.get("owned_items", [])),
            ring_quantities=ring_quantities,
            hidden_items=frozenset(d.get("hidden_items", [])),
            hidden_consumables_fine=frozenset(d.get("hidden_consumables_fine", [])),
            custom_stats=d.get("custom_stats", {}),
            skills_xp=d.get("skills_xp", {}),
            reputation=d.get("reputation", {}),
            achievement_points=int(d.get("achievement_points", 0)),
            coins=int(d.get("coins", 0)),
            steps=int(d.get("steps", 0)),
            owned_pets=frozenset(
                (str(t[0]), int(t[1])) for t in d.get("owned_pets", []) if isinstance(t, (list, tuple)) and len(t) == 2
            ),
            owned_collectibles=frozenset(
                str(c) for c in d.get("owned_collectibles", []) if c
            ),
        )

    @classmethod
    def from_character(cls, character) -> "CharacterStateSnapshot":
        """Build snapshot from existing util/character_export_util.py:Character."""
        owned = set()
        ring_qty: Dict[Tuple[str, str], int] = {}
        hidden_items = set()
        hidden_fine = set()

        # Iterate gear + inventory + bank for owned (slug, quality)
        # Use _all_items if available, else fall back to gear + inventory
        all_items = getattr(character, "_all_items", None) or {}
        if not all_items:
            # Build from gear + inventory + bank
            for src in ("gear", "inventory", "bank"):
                d = getattr(character, src, None) or {}
                if isinstance(d, dict):
                    all_items.update(d)

        # Read item-state overrides for hide flags from character (if present)
        # Hide flags are stored on character_config (in WalkScape's design).
        # We read from `_item_states` if present (parsed by Character).
        item_states = getattr(character, "_item_states", None) or {}

        for item_key, item_data in all_items.items():
            if not isinstance(item_data, dict):
                continue

            # item_key looks like 'rusty_pickaxe_normal' etc
            slug = item_data.get("slug") or item_data.get("import_name") or _slug_from_key(item_key)
            if not slug:
                continue

            qty = item_data.get("quantity", 1) or 1

            # Whole-item hide
            st = item_states.get(slug) or {}
            if st.get("hide"):
                hidden_items.add(slug)
            if st.get("hide_fine"):
                hidden_fine.add(slug)

            # Determine quality
            quality = item_data.get("quality") or st.get("quality") or "normal"
            quality_str = str(quality).lower()

            # Rings: per-instance hide flags + dual-quality
            ring1q = st.get("ring1_quality")
            ring2q = st.get("ring2_quality")
            if ring1q or ring2q:
                if ring1q and not st.get("hide_ring1"):
                    rq = str(ring1q).lower()
                    if slug not in hidden_items:
                        owned.add((slug, rq))
                        ring_qty[(slug, rq)] = ring_qty.get((slug, rq), 0) + 1
                if ring2q and ring2q not in (None, "None", "") and not st.get("hide_ring2"):
                    rq = str(ring2q).lower()
                    if slug not in hidden_items:
                        owned.add((slug, rq))
                        ring_qty[(slug, rq)] = ring_qty.get((slug, rq), 0) + 1
            else:
                if slug in hidden_items:
                    continue
                if quality_str == "fine" and slug in hidden_fine:
                    continue
                owned.add((slug, quality_str))

        return cls(
            owned_items=frozenset(owned),
            ring_quantities=ring_qty,
            hidden_items=frozenset(hidden_items),
            hidden_consumables_fine=frozenset(hidden_fine),
            custom_stats=getattr(character, "custom_stats", None) or {},
            skills_xp=dict(getattr(character, "skills", {}) or {}),
            reputation=dict(getattr(character, "reputation", {}) or {}),
            achievement_points=int(getattr(character, "achievement_points", 0) or 0),
            coins=int(getattr(character, "coins", 0) or 0),
            steps=int(getattr(character, "steps", 0) or 0),
        )


def _slug_from_key(key: str) -> str:
    """Fall back: strip trailing quality suffix from item key."""
    for suffix in ("_normal", "_good", "_great", "_excellent", "_perfect", "_eternal", "_fine"):
        if key.endswith(suffix):
            return key[:-len(suffix)]
    return key


# ============================================================================
# from_char_config — read character_config + ui_config directly
# ============================================================================
# 2026-05-25 (jwbail): from_character() relies on Character._all_items
# carrying dict-shaped item entries with slug/quality/etc. The worker's
# load_character() builds a "minimal export" Character whose _all_items
# is empty (its owned roster lives in raw inventory: {ItemInstance: qty}).
# state-changed and stale-check endpoints need to build a snapshot from
# the *stored* char_config (the simplified flat lists used by
# get_ownership_lookup), not by re-instantiating Character. This bypass
# also matches the data the worker uses, so prev/curr are comparable.

_RING_RARITY_SUFFIXES = (
    '_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal',
)
_RARITY_TO_QUALITY = {
    'common': 'normal', 'uncommon': 'good', 'rare': 'great',
    'epic': 'excellent', 'legendary': 'perfect', 'ethereal': 'eternal',
    'normal': 'normal', 'good': 'good', 'great': 'great',
    'excellent': 'excellent', 'perfect': 'perfect', 'eternal': 'eternal',
    'fine': 'fine',
}


def _strip_ring_rarity_suffix(slug: str):
    for suffix in _RING_RARITY_SUFFIXES:
        if slug.endswith(suffix):
            base = slug[:-len(suffix)]
            quality = suffix[1:]  # 'common' / 'rare' / etc.
            return base, _RARITY_TO_QUALITY.get(quality, quality)
    return slug, None


def from_char_config(char_config: dict, ui_config: dict = None) -> CharacterStateSnapshot:
    """Build a snapshot from the simplified char_config dict (sessions table).

    Reads owned_items / owned_quantities / item_qualities flat lists and
    user_overrides hide flags. Mirrors the data shape worker's
    get_ownership_lookup uses, so snapshots produced here compare cleanly
    with snapshots written by the worker at end-of-run.
    """
    char_config = char_config or {}
    ui_config = ui_config or {}
    if isinstance(ui_config, str):
        try:
            ui_config = json.loads(ui_config)
        except Exception:
            ui_config = {}

    overrides = ((ui_config.get('user_overrides') or {}).get('items') or {})

    hidden_items = set()
    hidden_fine = set()
    # 2026-05-29 (jwbail): manual ownership overrides. The has-checkbox /
    # has-checkbox-fine in column 1 writes here, NOT into char_config.
    # Without merging these into owned_items, ticking an item with
    # chest_finding (or any stat) produces a snapshot identical to the
    # cached one and stale detection silently never fires.
    manual_has = set()       # user_overrides.items[id].has === true
    manual_unhas = set()     # user_overrides.items[id].has === false
    manual_fine = set()
    manual_unfine = set()
    for item_id, state in overrides.items():
        if not isinstance(state, dict):
            continue
        if state.get('hide'):
            hidden_items.add(item_id)
        if state.get('hide_fine'):
            hidden_fine.add(item_id)
        has_val = state.get('has')
        if has_val is True:
            manual_has.add(item_id)
        elif has_val is False:
            manual_unhas.add(item_id)
        has_fine_val = state.get('has_fine')
        if has_fine_val is True:
            manual_fine.add(item_id)
        elif has_fine_val is False:
            manual_unfine.add(item_id)

    owned: set = set()
    ring_qty: Dict[Tuple[str, str], int] = {}

    # owned_items: flat list, may carry rarity suffix for rings.
    for export_name in (char_config.get('owned_items') or []):
        if not isinstance(export_name, str) or not export_name:
            continue
        base, quality = _strip_ring_rarity_suffix(export_name)
        if base in hidden_items:
            continue
        if base in manual_unhas:
            continue
        owned.add((base, quality or 'normal'))

    # item_qualities: per-quality counts for rings (and a few crafted items).
    for slug, qmap in (char_config.get('item_qualities') or {}).items():
        if slug in hidden_items:
            continue
        if slug in manual_unhas:
            continue
        if not isinstance(qmap, dict):
            continue
        for quality_label, count in qmap.items():
            try:
                count = int(count)
            except (TypeError, ValueError):
                count = 0
            if count <= 0:
                continue
            qnorm = _RARITY_TO_QUALITY.get(str(quality_label).lower(), str(quality_label).lower())
            owned.add((slug, qnorm))
            ring_qty[(slug, qnorm)] = ring_qty.get((slug, qnorm), 0) + count

    # owned_quantities: bare-slug → qty for materials/consumables/etc.
    # No quality info; default to 'normal'.
    for slug, qty in (char_config.get('owned_quantities') or {}).items():
        try:
            if int(qty) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        if not isinstance(slug, str) or not slug or slug in hidden_items:
            continue
        if slug in manual_unhas:
            continue
        owned.add((slug, 'normal'))

    # 2026-05-29: apply has=true / has_fine=true overrides as additions.
    # Default quality is 'normal' for has=true (matches column-2 optimizer
    # which treats has-checkbox as "I own at least one Normal-quality
    # instance"). has_fine=true adds a (slug, 'fine') tuple in addition.
    # has=false / has_fine=false were applied above as subtractions.
    for slug in manual_has:
        if not isinstance(slug, str) or not slug or slug in hidden_items:
            continue
        # Read explicit quality override if user picked one, else default.
        st = overrides.get(slug) or {}
        q = st.get('quality')
        qnorm = _RARITY_TO_QUALITY.get(str(q).lower(), 'normal') if q else 'normal'
        owned.add((slug, qnorm))
    for slug in manual_fine:
        if not isinstance(slug, str) or not slug or slug in hidden_items:
            continue
        if slug in hidden_fine:
            continue
        owned.add((slug, 'fine'))
    # has_fine=false subtraction (after additions, before freezing)
    for slug in manual_unfine:
        owned.discard((slug, 'fine'))

    # 2026-06-15 (jwbail): apply per-item QUALITY overrides to owned gear.
    # Column 1's quality dropdown writes user_overrides.items[slug].quality
    # (e.g. 'Perfect'). For an item owned via the imported export — owned_items
    # carries the ORIGINAL quality (e.g. golden_cutting_mat_epic = Excellent)
    # and owned_quantities adds a bare 'normal' entry — the override was only
    # consulted for manual has=true adds, so changing Excellent->Perfect never
    # changed the snapshot and stale detection never fired (user-reported:
    # "I change golden cutting mat to perfect but the tailoring chest doesn't
    # go stale"). The override is authoritative for that item's quality, so
    # REPLACE the slug's owned quality with it. _write_stats_report_result_row
    # builds the stored dominance_bitmap from this same from_char_config
    # snapshot, so both sides stay consistent. Skip rings — their per-instance
    # qualities live in item_qualities and use the ring1/ring2 fields, not the
    # single 'quality' field.
    _ring_slugs = set(char_config.get('item_qualities') or {})
    for _slug, _st in overrides.items():
        if not isinstance(_st, dict):
            continue
        _q = _st.get('quality')
        if not _q or _slug in _ring_slugs or _slug in hidden_items or _slug in manual_unhas:
            continue
        if not any(sl == _slug for (sl, _qq) in owned):
            continue  # only override the quality of an item the character owns
        _qnorm = _RARITY_TO_QUALITY.get(str(_q).lower(), str(_q).lower())
        owned = {(sl, qq) for (sl, qq) in owned if sl != _slug}
        owned.add((_slug, _qnorm))

    # 2026-06-16 (jwbail): source custom-stats toggle + skill-level overrides
    # the SAME way load_character (the optimizer) now does, so the snapshot
    # changes when the user toggles a custom stat or overrides a level in
    # column 1 — otherwise prev==curr and the (!) never fires for those.
    #  - custom_stats lives in ui_config.custom_stats (not char_config).
    #  - user_overrides.skills are LEVELS; convert to xp and merge into
    #    skills_xp (explicit skills_xp overrides win).
    _uo = (ui_config.get('user_overrides') or {})
    _skills_xp = dict(char_config.get('skills_xp') or char_config.get('skills') or {})
    try:
        from util.walkscape_constants import level_to_xp
        for _s, _lvl in (_uo.get('skills') or {}).items():
            try:
                _skills_xp[_s] = level_to_xp(int(_lvl))
            except Exception:
                pass
    except Exception:
        pass
    for _s, _xp in (_uo.get('skills_xp') or {}).items():
        _skills_xp[_s] = _xp
    _custom_stats = dict(ui_config.get('custom_stats') or char_config.get('custom_stats') or {})

    # 2026-06-16 (jwbail): owned pets as (species_lower, level), mirroring
    # stats_report_worker._build_pet_items (char_config.pets + user_overrides
    # pet entries). Validated against PETS_BY_NAME so a non-pet override with a
    # stray 'level' doesn't pollute the set.
    _owned_pets = set()
    try:
        from util.autogenerated.pets import PETS_BY_NAME
        _known = {str(s).lower() for s in PETS_BY_NAME.keys()}
        # Column-1 pet overrides: an owned pet's level slider writes
        # {level, variant, quality} WITHOUT 'has' (has marks an ADD of an
        # un-owned pet). So for an already-owned pet the override just UPDATES
        # the level — apply it regardless of 'has' (mirrors quality overrides).
        _ov_items = _uo.get('items') if isinstance(_uo.get('items'), dict) else {}
        _pet_ov_level = {}
        _pet_has_add = {}
        for _oid, _st in _ov_items.items():
            if not isinstance(_st, dict):
                continue
            _sp = str(_oid).lower()
            if _sp not in _known:
                continue
            try:
                _lvl = int(_st.get('level') or 0)
            except Exception:
                _lvl = 0
            if _lvl > 0:
                _pet_ov_level[_sp] = _lvl
                if _st.get('has'):
                    _pet_has_add[_sp] = _lvl
        _seen_pet = set()
        for _pd in (char_config.get('pets') or []):
            if not isinstance(_pd, dict):
                continue
            _sp = (_pd.get('species') or '').lower()
            if _sp not in _known:
                continue
            try:
                _lvl = int(_pd.get('level') or 0)
            except Exception:
                _lvl = 0
            if _sp in _pet_ov_level:   # column-1 override wins for an owned pet
                _lvl = _pet_ov_level[_sp]
            # 2026-06-20 (bug ba8696eb): a pet present in char_config.pets is
            # OWNED regardless of level. Egg-stage pets carry level 0 (e.g.
            # "Tiger egg" species=tiger level=0 stage=egg), so the old `_lvl > 0`
            # gate dropped them from owned_pets — and applicable_sources then
            # surfaced their egg as a "new item" forever (the worker's
            # build_new_items_jobs has no level gate, so the two diverged).
            # The species is already validated against PETS_BY_NAME above, so
            # there's no override-pollution risk here; the >0 guard only ever
            # mattered for the _pet_ov_level/_pet_has_add override path below.
            _owned_pets.add((_sp, _lvl))
            _seen_pet.add(_sp)
        for _sp, _lvl in _pet_has_add.items():   # has:true adds of un-owned pets
            if _sp not in _seen_pet:
                _owned_pets.add((_sp, _lvl))
    except Exception:
        _owned_pets = set()

    # 2026-06-22 (jwbail, report 2316c608): normalize with the SAME canonical
    # transform the worker uses (util.stats_report.normalize.normalize_item_id)
    # so the owned set compares cleanly against the drop slugs in
    # applicable_sources._kinds_with_unowned_drops (which now uses the same
    # function). The previous weak transform (.lower / spaces->_ / drop ')
    # kept hyphens, so '99-year-old wine' normalized to '99-year-old_wine'
    # here but '99_year_old_wine' on the worker side — the owned collectible
    # never matched its own drop and its activity's new-items "collectibles"
    # scope ghosted as REASON_NEWLY_UNLOCKED forever (the (!) never cleared).
    from .normalize import normalize_item_id
    _owned_collectibles = set()
    for _c in (char_config.get('collectibles') or []):
        _name = _c if isinstance(_c, str) else (
            (_c.get('name') or _c.get('id') or _c.get('export_name') or '')
            if isinstance(_c, dict) else ''
        )
        if not _name:
            continue
        _cslug = normalize_item_id(_name)
        if _cslug:
            _owned_collectibles.add(_cslug)

    return CharacterStateSnapshot(
        owned_items=frozenset(owned),
        ring_quantities=ring_qty,
        hidden_items=frozenset(hidden_items),
        hidden_consumables_fine=frozenset(hidden_fine),
        custom_stats=_custom_stats,
        skills_xp=_skills_xp,
        reputation=dict(char_config.get('reputation') or {}),
        achievement_points=int(char_config.get('achievement_points', 0) or 0),
        coins=int(char_config.get('coins', 0) or 0),
        steps=int(char_config.get('steps', 0) or 0),
        owned_pets=frozenset(_owned_pets),
        owned_collectibles=frozenset(_owned_collectibles),
    )


# Expose as a classmethod for callers that prefer that style.
CharacterStateSnapshot.from_char_config = staticmethod(from_char_config)


def describe_state_changes(prev, curr) -> list:
    """Human-readable list of what changed between two snapshots, for the stale
    popup's "What changed" line. Focuses on the GLOBAL inputs that aren't
    already shown per-scope as added/removed items: pets (add/remove/level),
    custom-stat toggles, and skill levels. Returns [] when there's no prior
    snapshot or on any error (fail-open)."""
    if prev is None or curr is None:
        return []
    out = []
    try:
        def _title(s):
            return str(s).replace('_', ' ').strip().title()

        # Pets — diff by species (owned_pets is a set of (species, level)).
        prev_pets = {}
        for sp, lvl in getattr(prev, 'owned_pets', None) or ():
            prev_pets[sp] = max(prev_pets.get(sp, 0), lvl)
        curr_pets = {}
        for sp, lvl in getattr(curr, 'owned_pets', None) or ():
            curr_pets[sp] = max(curr_pets.get(sp, 0), lvl)
        for sp in sorted(set(prev_pets) | set(curr_pets)):
            pl, cl = prev_pets.get(sp), curr_pets.get(sp)
            if pl is None and cl is not None:
                out.append(f"{_title(sp)} pet added (level {cl})")
            elif cl is None and pl is not None:
                out.append(f"{_title(sp)} pet removed")
            elif pl != cl:
                out.append(f"{_title(sp)}: level {pl} \u2192 {cl}")

        # Custom-stat toggles.
        pcs, ccs = dict(prev.custom_stats), dict(curr.custom_stats)
        for k in sorted(set(pcs) | set(ccs)):
            pv, cv = bool(pcs.get(k)), bool(ccs.get(k))
            if pv != cv:
                out.append(f"Custom stat \u201c{_title(k)}\u201d {'enabled' if cv else 'disabled'}")

        # Skill levels (derived from skills_xp).
        pls, cls = prev.skill_levels, curr.skill_levels
        for s in sorted(set(pls) | set(cls)):
            a, b = pls.get(s), cls.get(s)
            if a is not None and b is not None and a != b:
                out.append(f"{_title(s)}: level {a} \u2192 {b}")
    except Exception:
        return out
    return out
