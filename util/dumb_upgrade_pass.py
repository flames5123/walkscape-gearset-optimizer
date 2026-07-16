"""
Dumb stat-dominance post-pass for gearset optimizers.

Runs once after local-search refinement finishes. For each slot, looks for an
owned candidate item that is STRICTLY BETTER than the currently-equipped item
on a fixed whitelist of "always relevant" stats, while also preserving
every other stat the current item had (FMF, QO, find_*, inventory_space,
custom stats, etc.).

Why this exists
---------------
If the user doesn't configure a secondary optimization target (e.g. chests,
item-finding) that happens to be the differentiator between two items, the
normal optimizer can legitimately pick the weaker one because the
differentiator isn't in its objective. Real-world example (bug db0613d9):
user has both golden and clay skydisc; optimizer picks clay skydisc because
chest_finding wasn't a configured objective, even though golden skydisc has
strictly-better stats across the board.

This pass is DELIBERATELY dumb — it looks only at raw item stats, not
metrics or simulated performance. Two rules must both hold for a swap:

  (a) "Not worse" on EVERY stat the current item has, across ALL stat
      keys — including stats excluded from the "trigger" whitelist like
      fine_material_finding, quality_outcome, find_collectibles, etc.
      Sign-aware: `steps_add` and `steps_percent` are LOWER-is-better
      (they add to step count). Everything else is higher-is-better.

  (b) "Strictly better" on at least one stat from the trigger whitelist
      (tier 1 ∪ tier 2, plus NMC for crafting). FMF, QO, find_*, etc.
      never trigger a swap by themselves — per user spec "no FMF".

Whitelist and priority
----------------------
TIER 1 (core throughput — top priority for tiebreaker):
    work_efficiency, double_action, double_rewards

TIER 2 (the stats the user named explicitly):
    bonus_xp_percent, bonus_xp_add, steps_add, steps_percent,
    chest_finding, item_finding (+ any ItemFindingCategory.* variants),
    no_materials_consumed  (crafting only — pass `include_nmc=True`)

TIER 3 (tiebreaker-only for "strict better" trigger; STILL blocks if
dropped):
    inventory_space

Sign semantics
--------------
LOWER_IS_BETTER_STATS = {steps_add, steps_percent}

  Example: steps_add=0 (current) vs steps_add=+2 (candidate) → candidate
  WORSE (adds 2 more steps per action). Do not swap.
  Example: steps_add=0 (current) vs steps_add=-3 (candidate) → candidate
  BETTER (3 fewer steps per action). Swap if nothing else is lost.

Rules in full
-------------
A candidate K replaces current C iff ALL of:
    1. K.slot matches C.slot (or fits the same gearset key)
    2. K is unlocked for the character
    3. K.keywords ⊇ C.keywords   (preserves set-piece contributions and
       activity keyword requirements — "frisbee" etc.)
    4. For every stat S across the UNION of K's and C's stats:
         if S in LOWER_IS_BETTER_STATS: K[S] ≤ C[S]
         else:                          K[S] ≥ C[S]
       No stat anywhere is allowed to get worse — this is the "EVERYTHING
       is better, not a single stat can be different" rule.
    5. At least one stat in tier 1 ∪ tier 2 is strictly better
       (or, for an EMPTY current slot, at least one tier-3 stat).
    6. Any "specific item name" requirement the current item satisfies is
       also satisfied by K (handled via required_item_names set).

Lexicographic tiebreaker for picking among multiple dominating candidates:
    WE → DA → DR → XP% → XPBonus → Steps+ (lower-is-better) → Steps%
    (lower-is-better) → Chest% → IF (item_finding) → ItemFindingCategory.*
    → NMC → inventory_space → name → uuid (final deterministic fallbacks).

Per-swap logging (when verbose=True, default) prints:
    [slot] BeforeName  ->  AfterName
      triggered by: stat: before -> after, ...
      other stat changes: stat*: before -> after, ...  (* = lower-is-better)

so the engineer can verify exactly why each swap fired.
"""

from typing import Optional, Tuple

# ============================================================================
# Stat priority
# ============================================================================

# Tier 1: core throughput stats that always matter
TIER_1_STATS = (
    'work_efficiency',
    'double_action',
    'double_rewards',
)

# Tier 2: user-listed stats (non-FMF, non-QO)
TIER_2_STATS_COMMON = (
    'bonus_xp_percent',
    'bonus_xp_add',
    'steps_add',
    'steps_percent',
    'chest_finding',
    'item_finding',
)

# Tier 3: tiebreaker-only
TIER_3_STATS = (
    'inventory_space',
)

# ItemFindingCategory.* stats are treated as "item_finding" (same tier-2 bucket)
_IF_CATEGORY_PREFIX = 'ItemFindingCategory.'

# Stats where LOWER values are BETTER (they add to the step count per action).
# Everything else in WalkScape is higher-is-better.
#   steps_add:      added flat to steps/action. positive = more steps = worse.
#   steps_percent:  multiplied (1 + steps_percent) into steps/action. >0 = more
#                   steps = worse; <0 (e.g. -0.05) = 5% fewer steps = better.
LOWER_IS_BETTER_STATS = {
    'steps_add',
    'steps_percent',
}

# Keywords that are purely cosmetic / categorization and NEVER provide a
# functional bonus, a set-piece threshold, or an activity requirement. Losing
# one of these must NOT block an otherwise strict stat upgrade.
#
# Bug ff0483f0 (ring domination): 'Fingerpick' carries keywords
# ['Ring', 'Mining']; a strictly-better plain ring like 'Gold ruby ring' only
# has ['Ring']. The keyword-containment rule (`cur_keywords ⊆ cand_keywords`)
# then refused EVERY ring upgrade because the candidate "dropped" the cosmetic
# 'Mining' skill tag — even though that tag confers nothing. The same class of
# bug affected achievement-reward rings ('Shiny ring', 'Fine pearl ring')
# whose 'Achievement reward' tag blocked upgrades.
#
# These are skill-category tags + cosmetic tags. Genuinely functional keywords
# (set-piece names, 'Light source', 'Magnetic', activity requirements like
# 'Pickaxe'/'Frisbee') are NOT here and are still enforced via the containment
# rule (required_keywords + active set-piece counts).
COSMETIC_KEYWORDS = {
    'ring',
    'achievement reward',
    # Skill-category tags (WalkScape's 12 skills) — these categorize a piece of
    # gear by theme, they are not functional keyword requirements.
    'agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging',
    'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting',
    # Broader skill-group / role category tags (also cosmetic themeing).
    'gathering', 'utility',
}


def _is_worse(cand_v: float, cur_v: float, stat: str) -> bool:
    """Return True if candidate's value for `stat` is worse than current's,
    respecting sign semantics (lower-is-better for steps_add/steps_percent)."""
    if stat in LOWER_IS_BETTER_STATS:
        return cand_v > cur_v
    return cand_v < cur_v


def _is_strictly_better(cand_v: float, cur_v: float, stat: str) -> bool:
    """Return True if candidate's value for `stat` is strictly better than
    current's, respecting sign semantics."""
    if stat in LOWER_IS_BETTER_STATS:
        return cand_v < cur_v
    return cand_v > cur_v


def _get_compare_stat_keys(include_nmc: bool, item_stats_union: set) -> Tuple[tuple, tuple, tuple]:
    """
    Return (tier1, tier2, tier3) stat-key tuples for this pass.

    tier2 is extended with any ItemFindingCategory.* keys that appear on
    either the current item or any candidate, plus optionally
    no_materials_consumed (for crafting).
    """
    tier1 = TIER_1_STATS
    tier2 = list(TIER_2_STATS_COMMON)
    # Add any ItemFindingCategory.* keys present on the items being compared
    for k in sorted(item_stats_union):
        if k.startswith(_IF_CATEGORY_PREFIX):
            tier2.append(k)
    if include_nmc:
        tier2.append('no_materials_consumed')
    return tier1, tuple(tier2), TIER_3_STATS


# ============================================================================
# Item stat extraction
# ============================================================================

def _get_item_stats(item, skill: str, location, character, set_piece_counts: Optional[dict]) -> dict:
    """
    Get an item's stats for a (skill, location) pair, using the provided
    set_piece_counts so gated set bonuses are applied consistently across
    the current item and candidate comparison.

    Returns {} if the item has no get_stats_for_skill method (e.g., non-gear
    placeholders) or the stats would be unavailable.
    """
    if item is None:
        return {}
    if not hasattr(item, 'get_stats_for_skill'):
        return {}
    try:
        return item.get_stats_for_skill(
            skill,
            location=location,
            character=character,
            set_piece_counts=set_piece_counts,
        ) or {}
    except Exception:
        return {}


def _item_keywords(item) -> set:
    """Return the item's keywords as a lowercase set (or empty set)."""
    if item is None:
        return set()
    kws = getattr(item, 'keywords', None) or []
    return {str(k).lower() for k in kws}


def _candidate_conflicts_with_other_tools(
    candidate,
    gearset: dict,
    slot_being_upgraded: str,
) -> bool:
    """Check whether equipping `candidate` in `slot_being_upgraded` would
    violate tool-slot uniqueness constraints vs. the OTHER equipped tools.

    WalkScape tool slots enforce two independent constraints per the wiki
    (https://wiki.walkscape.app/wiki/Keywords):

      1. Each item UUID may only appear in one tool slot at a time.
      2. Each non-categorization keyword (e.g. "Sickle", "Pickaxe",
         "Hatchet", "Fishing rod") may only appear on one equipped tool.
         "Categorization" keywords like "Crafting tool" or "Skill book"
         are allowed on multiple tools — these live in
         `EXCLUDED_TOOL_KEYWORDS` in walkscape_constants.

    The dumb-upgrade pass walks slots independently, so without this check
    it can swap-in a second copy of an already-equipped sickle/pickaxe/etc.
    on a different tool slot. Bug report 51edce1a: user running wreck
    diving saw 2x Hydrilium sickle suggested (tool1 + tool3) because the
    dumb pass didn't know tool1 already had one.

    Only applies to tool slots (`tool0`..`tool5`, `tools`); returns False
    unconditionally for gear slots, ring slots, and pet/consumable slots.
    """
    if not slot_being_upgraded.startswith('tool'):
        return False
    if candidate is None:
        return False

    # Lazy import to avoid import cycles at module load
    from util.walkscape_constants import EXCLUDED_TOOL_KEYWORDS, BANNED_KEYWORD_GROUPS

    cand_uuid = getattr(candidate, 'uuid', None)
    cand_keywords = _item_keywords(candidate)
    cand_banned_kws = cand_keywords - EXCLUDED_TOOL_KEYWORDS

    # Which banned groups does the candidate belong to?
    cand_banned_groups = set()
    for i, group in enumerate(BANNED_KEYWORD_GROUPS):
        if cand_banned_kws & group:
            cand_banned_groups.add(i)

    for other_slot, other_item in gearset.items():
        if other_slot == slot_being_upgraded:
            continue  # the slot being replaced doesn't count as a conflict
        if not other_slot.startswith('tool'):
            continue
        if other_item is None:
            continue

        # UUID uniqueness: same item cannot occupy two tool slots
        other_uuid = getattr(other_item, 'uuid', None)
        if cand_uuid and other_uuid and cand_uuid == other_uuid:
            return True

        other_keywords = _item_keywords(other_item)
        other_banned_kws = other_keywords - EXCLUDED_TOOL_KEYWORDS

        # Direct non-excluded keyword conflict (Sickle vs Sickle, etc.)
        if cand_banned_kws & other_banned_kws:
            return True

        # Banned-keyword-group conflict (e.g. Fishing rod vs Fishing net)
        if cand_banned_groups:
            for i, group in enumerate(BANNED_KEYWORD_GROUPS):
                if i not in cand_banned_groups:
                    continue
                if other_banned_kws & group:
                    return True

    return False


def _candidate_exceeds_ring_ownership(
    candidate,
    gearset: dict,
    slot_being_upgraded: str,
    character,
) -> bool:
    """Ring-slot ownership check: reject a ring candidate if equipping it
    would require more copies of that item than the character owns.

    Rings are special vs. tools — the game ALLOWS the same ring UUID in
    both ring slots if the player owns 2 or more of that ring. But it
    rejects slotting 2x of a ring the player only owns once. Bug 3437535e:
    user owns 1 Simple ring and the dumb pass swapped Simple ring into
    ring2 while it was already in ring1, creating a phantom second copy.

    The main optimizer guards against this via `validate_uuid_uniqueness`
    during greedy/local-search, but the dumb pass walks slots independently.

    Only applies to ring slots; returns False for every other slot so the
    caller can use it unconditionally without gating by slot name.
    """
    if slot_being_upgraded not in ('ring1', 'ring2'):
        return False
    if candidate is None:
        return False
    cand_uuid = getattr(candidate, 'uuid', None)
    if not cand_uuid:
        return False

    # Count how many OTHER ring slots already hold this UUID after the swap
    other_ring_count = 0
    for other_slot, other_item in gearset.items():
        if other_slot == slot_being_upgraded:
            continue
        if other_slot not in ('ring1', 'ring2'):
            continue
        if other_item is None:
            continue
        if getattr(other_item, 'uuid', None) == cand_uuid:
            other_ring_count += 1

    # Total copies that would be equipped after the hypothetical swap
    total_after_swap = other_ring_count + 1

    # Look up how many the character owns by UUID. Walk `character.items`
    # because its keys may be ItemInstance objects keyed by identity (so
    # dict lookup by item != reliable) and the cache `_uuid_cache` may
    # not be populated yet.
    owned_qty = 0
    items_iter = getattr(character, 'items', None)
    if items_iter is not None:
        for inv_item, qty in items_iter.items():
            if qty is None or qty <= 0:
                continue
            if getattr(inv_item, 'uuid', None) == cand_uuid:
                owned_qty += qty

    # Reject if we'd need more copies than owned
    return total_after_swap > owned_qty


def _item_name_lower(item) -> str:
    if item is None:
        return ''
    n = getattr(item, 'name', '') or ''
    return n.lower()


def _is_unlocked(item, character) -> bool:
    """Check unlock status the same way the main optimizer does."""
    if item is None:
        return True
    if hasattr(item, 'is_unlocked'):
        try:
            if not item.is_unlocked(character, ignore_gear_requirements=True):
                return False
        except TypeError:
            # Some implementations don't accept the kwarg
            try:
                if not item.is_unlocked(character):
                    return False
            except Exception:
                return True
        except Exception:
            return True
    # Generic items with requirements list
    if hasattr(item, 'requirements') and isinstance(item.requirements, list):
        for req in item.requirements:
            if isinstance(req, dict) and req.get('type') == 'skill':
                req_skill = (req.get('skill') or '').lower()
                req_level = int(req.get('level', 0))
                if req_skill and req_level > 0:
                    get_level = getattr(character, 'get_skill_level', None)
                    char_level = get_level(req_skill) if get_level else 0
                    if char_level < req_level:
                        return False
    return True


# ============================================================================
# Set-piece preservation
# ============================================================================

def _compute_set_piece_counts(gearset: dict) -> dict:
    """
    Count unique items per (lowercase) keyword across the entire gearset.
    Matches the logic in util.gearset_utils._calculate_set_piece_counts_from_items.
    """
    sets: dict = {}
    seen_per_set: dict = {}
    for item in gearset.values():
        if item is None:
            continue
        if not hasattr(item, 'keywords') or not item.keywords:
            continue
        uuid = getattr(item, 'uuid', None)
        if uuid is None:
            # Fall back to id() for items without uuid (consumables etc.)
            uuid = id(item)
        for kw in item.keywords:
            kw_lower = str(kw).lower()
            if kw_lower not in seen_per_set:
                seen_per_set[kw_lower] = set()
            seen_per_set[kw_lower].add(uuid)
    for kw, uuids in seen_per_set.items():
        sets[kw] = len(uuids)
    return sets


# ============================================================================
# Dominance check
# ============================================================================

def _dominates(cand_stats: dict, cur_stats: dict, tier1: tuple, tier2: tuple,
               tier3: tuple, allow_tier3_strict: bool,
               irrelevant_stats: Optional[set] = None) -> Tuple[bool, list, list]:
    """
    Return (is_dominant, strict_better_keys, tier3_strict_keys) where:
        is_dominant: True if cand strictly dominates cur.
        strict_better_keys: list of tier-1/tier-2 stats where cand is
            strictly better than cur (for logging).
        tier3_strict_keys: list of tier-3 stats where cand is strictly
            better (only populated when allow_tier3_strict=True; for
            logging of empty-slot fills).

    Dominance rules (per user spec "EVERYTHING must be better, not a
    single stat can be different"):

        1. "Not worse" on EVERY stat the current item has, AND every stat
           the candidate has — across ALL stat keys (FMF, QO, find_*,
           ItemFindingCategory.*, etc.), NOT just the tier-1/tier-2
           whitelist. This is the core "no trade-offs" rule. Uses
           sign-aware comparison: for `steps_add` and `steps_percent`,
           LOWER is better; for everything else, higher is better.

           EXCEPTION: stats listed in `irrelevant_stats` are ignored in
           BOTH the "not worse" and the "strictly better" checks. The
           travel optimizer uses this to mark stats like
           fine_material_finding as fully ignored — losing FMF should
           not block a chest_finding upgrade on travel routes (bug
           0c92a9e8: 2x Silver sun stone ring (FMF=2) won over 2x Gold
           sun stone ring (chest_finding=5) because every gold candidate
           dropped the silver's FMF).

        2. "Strictly better" on at least one stat from the whitelist
           (tier1 ∪ tier2 — including any `ItemFindingCategory.*` keys
           seen on either item; NMC for crafting). FMF, QO, find_*
           cannot TRIGGER a swap by themselves — they just can't be
           dropped (unless listed as irrelevant).

        3. EXCEPTION for empty current slot: tier-3 (inventory_space)
           strict-better also qualifies as a swap trigger so we can fill
           empty slots with a +inventory_space item.

    Returns False if any stat anywhere is worse (excluding irrelevant
    stats), or if no whitelist stat (or tier-3 when allowed) is strictly
    better.
    """
    irrelevant_stats = irrelevant_stats or set()
    whitelist_strict_keys = tuple(tier1) + tuple(tier2)

    # "Not worse" check: iterate the UNION of stats on both items. Any
    # stat the current item has that the candidate drops counts as "worse".
    # Any stat the candidate has that was missing on current counts as
    # "candidate adds something" (not worse, possibly strictly better if
    # the stat is a dominance trigger).
    all_keys = set(cur_stats.keys()) | set(cand_stats.keys())

    strict_better_whitelist: list = []
    tier3_strict: list = []

    for k in all_keys:
        # Stats marked as irrelevant for this skill are skipped entirely:
        # losing them doesn't block a swap, and gaining them doesn't trigger
        # one. Travel routes pass FMF/find_collectibles here so chest_finding
        # upgrades aren't blocked by an existing item that happened to have
        # FMF on it (bug 0c92a9e8).
        if k in irrelevant_stats:
            continue
        cur_v = cur_stats.get(k, 0.0) or 0.0
        cand_v = cand_stats.get(k, 0.0) or 0.0
        if cur_v == cand_v:
            continue
        if _is_worse(cand_v, cur_v, k):
            return False, [], []  # candidate dropped or lowered a stat
        # Candidate is strictly better on this stat. Record whether it's
        # a trigger stat (tier 1/2 whitelist) or a tier-3/other-category
        # improvement.
        if k in whitelist_strict_keys:
            strict_better_whitelist.append(k)
        elif k in tier3:
            tier3_strict.append(k)
        # Other stats (FMF, QO, find_*) that are better on candidate
        # don't count as swap triggers by themselves (per user spec "no
        # FMF") — they're just a nice bonus.

    if strict_better_whitelist:
        return True, strict_better_whitelist, tier3_strict
    if allow_tier3_strict and tier3_strict:
        return True, strict_better_whitelist, tier3_strict
    return False, [], []


def _tiebreak_key(stats: dict, item, tier1: tuple, tier2: tuple, tier3: tuple) -> tuple:
    """
    Lexicographic comparison key: higher tier-1 stats first, then tier-2,
    then tier-3, then deterministic (name, uuid) so ties are stable.
    Returns a tuple suitable for `max(..., key=_tiebreak_key)`.

    Sign-aware: for LOWER_IS_BETTER_STATS (steps_add, steps_percent) we
    negate the value so `max()` picks the candidate with the lowest
    (best) value.
    """
    def _orient(stat: str, value: float) -> float:
        return -value if stat in LOWER_IS_BETTER_STATS else value

    vals = []
    for k in tier1:
        vals.append(_orient(k, stats.get(k, 0.0) or 0.0))
    for k in tier2:
        vals.append(_orient(k, stats.get(k, 0.0) or 0.0))
    for k in tier3:
        vals.append(_orient(k, stats.get(k, 0.0) or 0.0))
    # Final deterministic breakers
    name = _item_name_lower(item)
    uuid = str(getattr(item, 'uuid', '') or '')
    return tuple(vals) + (name, uuid)


# ============================================================================
# Candidate enumeration
# ============================================================================

def _candidates_for_slot(slot: str, character, skill: str, location, current_item) -> list:
    """
    Return owned items that fit `slot` (excluding the current item itself),
    filtered by unlock state.

    Rings have slot="ring" in the item data but occupy "ring1"/"ring2" in
    the gearset. Tools/tool similar. We normalize here.
    """
    wanted_slots = {slot}
    if slot in ('ring1', 'ring2'):
        wanted_slots = {'ring', 'ring1', 'ring2'}
    if slot in ('tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tools'):
        wanted_slots = {'tool', 'tools', slot}

    out = []
    current_uuid = getattr(current_item, 'uuid', None) if current_item else None
    items_iter = getattr(character, 'items', None)
    if items_iter is None:
        return out
    for item, qty in items_iter.items():
        if qty is None or qty <= 0:
            continue
        item_slot = getattr(item, 'slot', None)
        if item_slot is None:
            continue
        if item_slot not in wanted_slots:
            continue
        # Don't consider the exact same item instance
        if item is current_item:
            continue
        # Don't consider a different instance with the same UUID if the
        # current item is already in-slot — that's the same underlying item
        # (wasted work, but also avoids "upgrading" to a duplicate).
        if current_uuid is not None and getattr(item, 'uuid', None) == current_uuid:
            continue
        if not _is_unlocked(item, character):
            continue
        out.append(item)
    return out


# ============================================================================
# Public entry point
# ============================================================================

def apply_dumb_stat_upgrade(
    gearset: dict,
    character,
    skill: str,
    location=None,
    *,
    include_nmc: bool = False,
    required_keywords: Optional[set] = None,
    required_item_names: Optional[set] = None,
    locked_slots: Optional[set] = None,
    skip_empty_slot_fill: bool = False,
    irrelevant_stats: Optional[set] = None,
    verbose: bool = True,
) -> dict:
    """
    Run a single-pass "dumb" stat-dominance upgrade over the gearset.

    Args:
        gearset: dict {slot_name: item or None} — the finalized gearset from
            the optimizer. NOT mutated; a new dict is returned.
        character: Character object with .items inventory and unlock state.
        skill: Skill string (e.g. "agility", "hunting", "carpentry").
        location: LocationInfo / string / None — used when computing item stats.
        include_nmc: Pass True for crafting; adds no_materials_consumed to the
            dominance check.
        required_keywords: Keywords the gearset must still provide (e.g.
            activity requirements like "frisbee"). If the current item
            uniquely supplies such a keyword, the candidate must also
            supply it — this is covered automatically by the
            "candidate keywords ⊇ current keywords" rule for the swapped
            slot, but extra requirements are honored by ensuring removal
            doesn't drop below these required keywords.
        required_item_names: Lowercase item names that the activity/service
            explicitly requires by name. If the current item's name is in
            this set, the swap is blocked (unless the candidate has the
            same name, which would mean swapping a duplicate — skipped).
        locked_slots: Slots the user has pinned; never swap these.
        skip_empty_slot_fill: When True, never swap an item into a currently
            empty slot. Used by the travel optimizer where the greedy phase
            has already considered (and rejected) every candidate against an
            "empty" baseline using the actual primary metric — a candidate
            with secondary stats only (e.g. chest_finding) shouldn't be
            re-introduced by the dumb pass since it doesn't strictly
            improve travel steps. Bug b1e44232: long GDTE route had ring1
            correctly Stepring, ring2 left empty, then dumb pass swapped
            empty -> Gold sun stone ring (Eternal) "triggered by
            chest_finding 0 -> 0.06" — a useless ring on a non-light route.
        irrelevant_stats: Optional set of stat keys that are fully ignored
            in dominance comparisons — they neither block a swap (when
            dropped) nor trigger one (when gained). Travel callers pass
            {fine_material_finding, find_collectibles} so chest_finding
            upgrades aren't blocked by FMF the current item happened to
            have. Bug 0c92a9e8: 2x Silver sun stone ring (FMF=2) won
            over 2x Gold sun stone ring (chest_finding=5) because every
            gold candidate dropped the silver's FMF, blocking the swap.
        verbose: Print swap decisions.

    Returns:
        A new gearset dict with any upgrades applied.
    """
    if not gearset:
        return gearset

    required_keywords = {k.lower() for k in (required_keywords or set())}
    required_item_names = {n.lower() for n in (required_item_names or set())}
    locked_slots = set(locked_slots or set())
    irrelevant_stats = set(irrelevant_stats or set())

    result = dict(gearset)

    # Snapshot set_piece counts of the incoming gearset. We use these when
    # computing stats for both current item and candidates so the comparison
    # is apples-to-apples. The keyword-containment rule below ensures any
    # candidate whose keywords ⊇ current's keywords only INCREASES the
    # real set-piece bonuses post-swap, never decreases them, so comparing
    # under the pre-swap counts is safe (conservative).
    set_piece_counts = _compute_set_piece_counts(result)

    swaps = []

    # Iterate slots in a stable order for deterministic output.
    for slot in sorted(result.keys()):
        if slot in locked_slots:
            continue
        current_item = result.get(slot)

        # Skip filling empty slots when the caller requested it (travel
        # optimizer). Greedy has already considered every candidate against
        # an "empty" baseline using the actual primary metric; if it left
        # this slot empty, no candidate strictly improves the metric and
        # the dumb pass should not second-guess that.
        if skip_empty_slot_fill and current_item is None:
            continue

        # Skip the consumable slot — consumables don't follow standard stat
        # semantics (they're not "gear" in the swapping sense). The regular
        # optimizer handles consumable selection directly.
        if slot == 'consumable':
            continue

        # Skip pet slot — pets have their own optimization logic and level
        # effects that this dumb pass doesn't model.
        if slot == 'pet':
            continue

        # Block swapping a current item that matches a specific-item-name
        # requirement (unless we'd keep the same name, which is a duplicate
        # and thus skipped anyway by _candidates_for_slot)
        if current_item is not None:
            cur_name = _item_name_lower(current_item)
            if cur_name in required_item_names:
                continue

        candidates = _candidates_for_slot(slot, character, skill, location, current_item)
        if not candidates:
            continue

        # Compute current item's stats once
        cur_stats = _get_item_stats(current_item, skill, location, character, set_piece_counts)
        cur_keywords = _item_keywords(current_item)

        # Build the union of stat keys across current + candidates so we can
        # determine which ItemFindingCategory.* keys to include in the
        # dominance check.
        stats_union = set(cur_stats.keys())
        cand_stats_cache = {}
        for cand in candidates:
            cs = _get_item_stats(cand, skill, location, character, set_piece_counts)
            cand_stats_cache[id(cand)] = cs
            stats_union.update(cs.keys())

        tier1, tier2, tier3 = _get_compare_stat_keys(include_nmc, stats_union)

        # Allow tier3 (inventory_space) to contribute "strictly greater" only
        # when the current slot is empty — per user spec, inv_space is
        # last-ditch.
        allow_tier3_strict = current_item is None

        # Special handling: if current_item is None, we still check the rule
        # but there's no keyword containment to enforce (nothing to preserve).
        dominating = []  # list of (candidate, cand_stats, strict_keys, t3_strict_keys)
        # Per-candidate rejection reasons, for diagnostic logging. Keyed by a
        # human-readable candidate name so a surviving pick (e.g. a
        # stat-dominated Fingerpick that should have been upgraded) can be
        # explained from the logs.
        rejections = []  # list of (cand_name, reason)
        for cand in candidates:
            cs = cand_stats_cache[id(cand)]
            cand_name = _item_name_lower(cand) or getattr(cand, 'name', '?')

            # Keyword containment: a candidate must still supply every keyword
            # the current item supplies, EXCEPT purely cosmetic / categorization
            # tags (COSMETIC_KEYWORDS: 'Ring', 'Achievement reward', skill tags
            # like 'Mining'). Dropping a cosmetic tag confers no loss and must
            # NOT block a strict stat upgrade (bug ff0483f0: Fingerpick's
            # ['Ring','Mining'] keywords blocked every plain-ring upgrade because
            # the candidate lacked the cosmetic 'Mining' tag). Functional
            # keywords — set-piece names, 'Light source', 'Magnetic', activity
            # requirements like 'Frisbee'/'Pickaxe' — are still enforced so we
            # never silently drop a real bonus or requirement.
            cand_kws = _item_keywords(cand)
            dropped_functional_kws = (cur_keywords - cand_kws) - COSMETIC_KEYWORDS
            if dropped_functional_kws:
                rejections.append((cand_name, f"missing functional keyword(s): {sorted(dropped_functional_kws)}"))
                continue

            # Tool-slot uniqueness: reject candidates that would duplicate
            # an item already equipped in another tool slot (same UUID) or
            # clash on a non-categorization keyword like "Sickle", "Pickaxe",
            # "Hatchet", or a banned-group fishing-tool variant. The main
            # optimizer validates this during greedy/local-search, but the
            # dumb pass walks slots independently and could otherwise swap
            # in a second Hydrilium sickle on tool3 when tool1 already has
            # one (bug 51edce1a).
            if _candidate_conflicts_with_other_tools(cand, result, slot):
                rejections.append((cand_name, "tool-slot keyword/uuid conflict"))
                continue

            # Ring-slot ownership: reject ring candidates that would require
            # more copies than the player owns (bug 3437535e: user owns 1
            # Simple ring, dumb pass put it in ring1 AND ring2).
            if _candidate_exceeds_ring_ownership(cand, result, slot, character):
                rejections.append((cand_name, "not enough copies owned for both ring slots"))
                continue

            is_dom, strict_keys, t3_strict = _dominates(
                cs, cur_stats, tier1, tier2, tier3, allow_tier3_strict,
                irrelevant_stats=irrelevant_stats,
            )
            if not is_dom:
                rejections.append((cand_name, "does not strictly dominate current"))
                continue

            dominating.append((cand, cs, strict_keys, t3_strict))

        # Diagnostic logging for ring slots (where the Fingerpick-vs-Gold-ruby
        # domination bug lives). Prints the current item, every candidate that
        # was considered, and why each was rejected — so a surviving pick can
        # be explained directly from the worker log.
        if verbose and slot in ('ring1', 'ring2'):
            _cur_name = current_item.name if current_item is not None else '(empty)'
            print(f"  [dumb-pass][{slot}] current={_cur_name} stats={ {k: round(v, 4) for k, v in cur_stats.items()} } "
                  f"candidates={len(candidates)} dominating={len(dominating)}")
            for _dc, _dcs, _dsk, _ in dominating:
                print(f"    ✓ dominates: {getattr(_dc, 'name', '?')} (better on {_dsk}) stats={ {k: round(v, 4) for k, v in _dcs.items()} }")
            for _rn, _rr in rejections:
                print(f"    ✗ {_rn}: {_rr}")

        if not dominating:
            continue

        # Pick the lexicographically best candidate
        winner = max(
            dominating,
            key=lambda tup: _tiebreak_key(tup[1], tup[0], tier1, tier2, tier3),
        )
        winner_cand, winner_stats, winner_strict, winner_t3_strict = winner

        result[slot] = winner_cand
        swaps.append((slot, current_item, winner_cand, cur_stats, winner_stats,
                      winner_strict, winner_t3_strict))

        # Refresh set_piece_counts since keywords may have changed. This
        # lets a later slot's comparison see up-to-date counts. (We stay
        # conservative via the keyword-containment rule either way, but
        # fresh counts make the picked winners' advertised stats accurate
        # for any follow-up logging.)
        set_piece_counts = _compute_set_piece_counts(result)

    if verbose and swaps:
        print(f"\n{'='*70}")
        print(f"DUMB STAT-DOMINANCE UPGRADE PASS — {len(swaps)} swap(s)")
        print(f"{'='*70}")
        for slot, before, after, cur_stats, cand_stats, strict_keys, t3_strict in swaps:
            b = before.name if before is not None else '(empty)'
            a = after.name if after is not None else '(empty)'
            print(f"  [{slot}] {b}  ->  {a}")
            # Show the stats that triggered the swap and any changed stats
            # across the whole item, so the engineer can verify correctness.
            triggers = strict_keys + t3_strict
            if triggers:
                parts = []
                for k in triggers:
                    cv = cur_stats.get(k, 0.0) or 0.0
                    nv = cand_stats.get(k, 0.0) or 0.0
                    parts.append(f"{k}: {cv:g} -> {nv:g}")
                print(f"    triggered by: {', '.join(parts)}")
            # List every other stat that differs, for auditability. Marks
            # lower-is-better stats with an asterisk so it's clear why
            # "higher" can be a regression.
            diff_parts = []
            for k in sorted(set(cur_stats.keys()) | set(cand_stats.keys())):
                if k in triggers:
                    continue
                cv = cur_stats.get(k, 0.0) or 0.0
                nv = cand_stats.get(k, 0.0) or 0.0
                if cv == nv:
                    continue
                marker = '*' if k in LOWER_IS_BETTER_STATS else ''
                diff_parts.append(f"{k}{marker}: {cv:g} -> {nv:g}")
            if diff_parts:
                print(f"    other stat changes: {', '.join(diff_parts)}")

    return result
