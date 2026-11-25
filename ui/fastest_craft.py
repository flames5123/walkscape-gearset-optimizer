"""Fastest Craft — backend optimization core (.kiro/specs/fastest-craft/).

Phase 2 of the Fastest Craft feature: for each craftable item selected via the
goals-report pills, build its crafting tree and report the fewest total
steps/craft at every quality (Normal→Eternal) × material variant
(normal / all-fine), reusing the EXACT crafting-tree optimizer.

This module is intentionally self-contained (no FastAPI/DB imports at module
load) so it is cheap to unit-test. The FAC-gated HTTP route (Phase 0 helper
`_require_fastest_craft_goals`) and the `fastest_craft_results` storage
(Phase 3) wire into `run_fastest_craft` separately.

Key facts it relies on (proven in tests/test_crafting_tree_*_parity*.py):
  * a sub-node's gearset is ancestor-independent, so each subtree is reusable;
  * only the BASE/root node changes with target quality, so per item we do
    6 separate base-node solves per material variant (12 total), and the
    fewer-steps variant is chosen PER QUALITY (fine eases higher qualities).

Phase 2.1 (this commit): pill→item enumeration (pure, unit-tested) + the
orchestrator that drives build_crafting_tree + optimize_tree_exact per
(item, variant, quality). Phase 2.2 layers in reuse of stored goals-report
sub-results (so a shared subtree is solved once); Phase 3 adds persistence.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Set

QUALITIES = ["Normal", "Good", "Great", "Excellent", "Perfect", "Eternal"]
VARIANTS = ["normal", "fine"]

# ── crafted-category mapping ────────────────────────────────────────────────
# Mirrors ui/catalog.py::_get_crafted_by_keyword (the Column-1 "Crafted (by
# keyword)" section the pills derive from). Kept in sync by hand; the catalog's
# copies are method-locals so they can't be imported directly. If the catalog
# mapping changes, update here too (see tests/test_fastest_craft_enumerate.py,
# which pins parity against the catalog's live categories).
CRAFTED_KEYWORD_TO_CATEGORY = {
    'amulet': 'Amulets',
    'chisel': 'Chisels',
    'diving gear': 'Diving Gear',
    'advanced diving gear': 'Diving Gear',
    'expert diving gear': 'Diving Gear',
    'fishing tool': 'Fishing Tools',
    'fishing net': 'Fishing Tools',
    'fishing rod': 'Fishing Tools',
    'fishing spear': 'Fishing Tools',
    'hammer': 'Hammers',
    'hatchet': 'Hatchets',
    'hunting bow': 'Hunting Bows',
    'needle': 'Needles',
    'pan': 'Pans',
    'pickaxe': 'Pickaxes',
    'ring': 'Rings',
    'saw': 'Saws',
    'shield': 'Shields',
    'sickle': 'Sickles',
    'toolbox': 'Toolboxes',
    'weapon': 'Weapons',
    'wrench': 'Wrenches',
}

# Slot-based categories (apply regardless of keyword). "Pant Slots → legs",
# "Chest Slots → chest", gloves → hands (spec R3 uses the slot icon for these).
CRAFTED_SLOT_TO_CATEGORY = {
    'chest': 'Chests',
    'legs': 'Pants',
    'hands': 'Gloves',
}

MISC_CATEGORY = 'Misc. Crafted'


def _is_crafted_item(item) -> bool:
    """A crafted (quality-bearing) equipment Item has NORMAL + GOOD quality
    attributes — the same test ui/catalog.py uses to populate the Crafted
    section."""
    return bool(item is not None and hasattr(item, 'NORMAL') and hasattr(item, 'GOOD'))


def crafted_categories_for_item(item) -> Set[str]:
    """Classify a crafted Item into its pill category set.

    Byte-for-byte the same precedence as ui/catalog.py::_get_crafted_by_keyword:
      1. keyword exact-match, else whole-word match against the keyword map;
      2. slot-based (chest/legs/hands);
      3. crafted neck-slot with no keyword match → Amulets;
      4. nothing matched → Misc. Crafted.
    """
    keywords = getattr(item, 'keywords', []) or []
    slot = (getattr(item, 'slot', '') or '')
    matched: Set[str] = set()
    for keyword in keywords:
        kw_lower = str(keyword).lower()
        if kw_lower in CRAFTED_KEYWORD_TO_CATEGORY:
            matched.add(CRAFTED_KEYWORD_TO_CATEGORY[kw_lower])
        else:
            for cat_key, cat_name in CRAFTED_KEYWORD_TO_CATEGORY.items():
                if re.search(r'\b' + re.escape(cat_key) + r'\b', kw_lower):
                    matched.add(cat_name)
                    break
    if slot in CRAFTED_SLOT_TO_CATEGORY:
        matched.add(CRAFTED_SLOT_TO_CATEGORY[slot])
    if not matched and slot == 'neck':
        matched = {'Amulets'}
    if not matched:
        matched = {MISC_CATEGORY}
    return matched


def all_crafted_categories(recipes_by_name=None) -> Set[str]:
    """Every keyword/slot category label that at least one craftable gear or
    tool item maps to."""
    cats: Set[str] = set()
    for row in enumerate_craftable_items(None, recipes_by_name):
        if row['group'] in (GROUP_GEAR, GROUP_TOOLS):
            cats |= set(row['categories'])
    return cats


# ── grouped chip taxonomy (Gear / Tools / Consumables / Materials) ──────────
GROUP_GEAR = 'gear'
GROUP_TOOLS = 'tools'
GROUP_CONSUMABLES = 'cons'
GROUP_MATERIALS = 'mat'

TAXONOMY_GROUPS = [
    {'key': GROUP_GEAR, 'label': 'Gear', 'color': '#5B8BD9',
     'icon': '/assets/icons/keywords/proper_gear.svg'},
    {'key': GROUP_TOOLS, 'label': 'Tools', 'color': '#D9A55B',
     'icon': '/assets/icons/keywords/tool.svg'},
    {'key': GROUP_CONSUMABLES, 'label': 'Consumables', 'color': '#66bb6a',
     'icon': '/assets/icons/text/sprite_20_icons/tab_consumables.svg'},
    {'key': GROUP_MATERIALS, 'label': 'Materials', 'color': '#ff9800',
     'icon': '/assets/icons/text/sprite_20_icons/tab_materials.svg'},
]

NEUTRAL_CHIP_COLOR = 'var(--text-secondary)'

CRAFTED_CATEGORY_META = {
    'Amulets':       ('keywords/amulet.svg', '#b06fd6'),
    'Chisels':       ('keywords/chisel.svg', '#9aa4b2'),
    'Diving Gear':   ('keywords/diving_gear.svg', '#4fc3f7'),
    'Fishing Tools': ('keywords/fishing_tool.svg', '#4fc3f7'),
    'Hammers':       ('keywords/smithing_hammer.svg', '#D9A55B'),
    'Hatchets':      ('keywords/hatchet.svg', '#8b5e3c'),
    'Hunting Bows':  ('keywords/hunting_bow.svg', '#a0522d'),
    'Needles':       ('keywords/needle.svg', '#8bbf5b'),
    'Pans':          ('keywords/cooking_pan.svg', '#ff9800'),
    'Pickaxes':      ('keywords/pickaxe.svg', '#7a8b99'),
    'Rings':         ('keywords/ring.svg', '#e0457c'),
    'Saws':          ('keywords/saw.svg', '#a1887f'),
    'Shields':       ('keywords/shield.svg', '#5B8BD9'),
    'Sickles':       ('keywords/sickle.svg', '#66bb6a'),
    'Toolboxes':     ('keywords/toolbox.svg', '#D9A55B'),
    'Weapons':       ('keywords/weapon.svg', '#e8734f'),
    'Wrenches':      ('keywords/wrench.svg', '#7a8b99'),
    'Chests':        ('slots/chest.svg', '#5B8BD9'),
    'Pants':         ('slots/legs.svg', '#8bbf5b'),
    'Gloves':        ('slots/hands.svg', '#D9A55B'),
    MISC_CATEGORY:   ('attributes/double_rewards.svg', '#9aa4b2'),
}

CONSUMABLE_TRAVEL = 'Traveling'
CONSUMABLE_GLOBAL = 'Global'
_CONSUMABLE_SPECIAL_META = {
    CONSUMABLE_TRAVEL: ('travel', 'Travel', 'text/sprite_20_icons/tools_maps.svg', '#00BCD4'),
    CONSUMABLE_GLOBAL: ('global', 'Global', 'text/sprite_20_icons/tools_global.svg', '#9aa4b2'),
}
_SKILL_COLORS = {
    'agility': '#F05FBE', 'carpentry': '#F18C62', 'cooking': '#F0AD5F',
    'crafting': '#E9487C', 'fishing': '#60DAEF', 'foraging': '#ABD3A1',
    'hunting': '#FEA255', 'mining': '#8CA4D4', 'smithing': '#E2A6A6',
    'tailoring': '#AAF2FE', 'trinketry': '#FEE0AC', 'woodcutting': '#5EF06B',
}

MATERIAL_GROUP_META = {
    'bar':          ('keywords/bar.svg', '#b0bec5'),
    'plank':        ('keywords/plank.svg', '#a1887f'),
    'gem':          ('keywords/gem.svg', '#e0457c'),
    'leather':      ('keywords/leather.svg', '#c9a06a'),
    'fabric':       ('keywords/fabric.svg', '#b06fd6'),
    'ingredient':   ('keywords/ingredient.svg', '#ff9800'),
    'hunting_trap': ('keywords/hunting_trap.svg', '#a0522d'),
    'hunting_net':  ('keywords/hunting_net.svg', '#8bbf5b'),
    'ectoplasm':    ('items/materials/ectoplasm.svg', '#7ad0a0'),
    'other':        ('attributes/double_rewards.svg', '#9aa4b2'),
}


def _slugify(label: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', str(label).lower()).strip('_')


def chip_id(group: str, label_or_slug: str) -> str:
    """Prefixed selection identity, e.g. 'gear:misc_crafted' / 'mat:bar'."""
    return f"{group}:{_slugify(label_or_slug)}"


def _icon_url(rel: Optional[str]) -> str:
    return f"/assets/icons/{rel}" if rel else ''


def _crafted_chip(group: str, label: str) -> Dict:
    icon, color = CRAFTED_CATEGORY_META.get(label, (None, NEUTRAL_CHIP_COLOR))
    return {'id': chip_id(group, label), 'label': label,
            'icon': _icon_url(icon), 'color': color}


def _consumable_chip(tab: str) -> Dict:
    special = _CONSUMABLE_SPECIAL_META.get(tab)
    if special:
        slug, label, icon, color = special
        return {'id': chip_id(GROUP_CONSUMABLES, slug), 'label': label,
                'icon': _icon_url(icon), 'color': color}
    skill = tab.lower()
    return {'id': chip_id(GROUP_CONSUMABLES, skill), 'label': tab,
            'icon': (_icon_url(f'text/skill_icons/{skill}.svg')
                     if skill in _SKILL_COLORS else ''),
            'color': _SKILL_COLORS.get(skill, NEUTRAL_CHIP_COLOR)}


def _material_chip(slug: str, label: str) -> Dict:
    icon, color = MATERIAL_GROUP_META.get(slug, (None, NEUTRAL_CHIP_COLOR))
    return {'id': chip_id(GROUP_MATERIALS, slug), 'label': label,
            'icon': _icon_url(icon), 'color': color}


def _classify_output(ref: str, obj) -> Optional[tuple]:
    """(group, [chip dicts]) for a craftable recipe output, or None when the
    output isn't in any Fastest Craft group.

    Gear/Tools: quality-bearing crafted Items split on slot == 'tools', chips
    from crafted_categories_for_item. Consumables: the owned-items consumable
    tabs (ui.catalog.consumable_skill_tabs). Materials: the goals-report
    target_items classifier."""
    if ref.startswith('Item.'):
        if not _is_crafted_item(obj):
            return None
        group = GROUP_TOOLS if getattr(obj, 'slot', '') == 'tools' else GROUP_GEAR
        return group, [_crafted_chip(group, c)
                       for c in sorted(crafted_categories_for_item(obj))]
    if ref.startswith('Consumable.'):
        if not hasattr(obj, '_stats'):
            return None
        from ui.catalog import consumable_skill_tabs
        return GROUP_CONSUMABLES, [_consumable_chip(t)
                                   for t in consumable_skill_tabs(obj)]
    if ref.startswith('Material.'):
        from util.stats_report.target_items import classify_item
        hit = classify_item(getattr(obj, 'name', ''), ref,
                            list(getattr(obj, 'keywords', None) or []))
        if not hit:
            return None
        slug, label = hit
        return GROUP_MATERIALS, [_material_chip(slug, label)]
    return None


_TRAILING_CHIP_RANK = {
    chip_id(GROUP_GEAR, MISC_CATEGORY): 1,
    chip_id(GROUP_TOOLS, MISC_CATEGORY): 1,
    chip_id(GROUP_CONSUMABLES, 'travel'): 1,
    chip_id(GROUP_CONSUMABLES, 'global'): 2,
    chip_id(GROUP_MATERIALS, 'other'): 1,
}


def _chip_sort_key(chip: Dict):
    """Alphabetical, with catch-all chips (Misc. Crafted, Travel, Global,
    Other) trailing."""
    return (_TRAILING_CHIP_RANK.get(chip['id'], 0), chip['label'].lower())


_TAXONOMY_CACHE: Optional[Dict] = None


def fastest_craft_taxonomy(recipes_by_name=None) -> Dict:
    """The grouped chip universe for the Fastest Craft sub-filter:
        {'groups': [{key, label, icon, color, chips: [{id, label, icon, color}]}]}
    in Gear, Tools, Consumables, Materials order. A chip is listed only when at
    least one craftable output maps to it, so e.g. Misc. Crafted appears under
    both Gear and Tools while Wrenches appears under Tools only.

    User-independent (derived from static game data), so the default-arg result
    is cached module-level — it is embedded in /api/feature-flags to avoid a
    second round-trip + the 'Loading craftable categories…' flash."""
    global _TAXONOMY_CACHE
    if recipes_by_name is None and _TAXONOMY_CACHE is not None:
        return _TAXONOMY_CACHE
    chips_by_group: Dict[str, Dict[str, Dict]] = {g['key']: {} for g in TAXONOMY_GROUPS}
    for row in enumerate_craftable_items(None, recipes_by_name):
        for chip in row['chips']:
            chips_by_group[row['group']].setdefault(chip['id'], chip)
    groups = []
    for g in TAXONOMY_GROUPS:
        chips = sorted(chips_by_group[g['key']].values(), key=_chip_sort_key)
        groups.append({**g, 'chips': chips})
    result = {'groups': groups}
    if recipes_by_name is None:
        _TAXONOMY_CACHE = result
    return result


def enumerate_craftable_items(selected_ids: Optional[Set[str]],
                              recipes_by_name=None) -> List[Dict]:
    """Return the craftable outputs (gear, tools, consumables, materials) in
    scope for the selected chips.

    Each result is
        {recipe_name, output_ref, output_name, group, chip_ids, categories, chips}
    where chip_ids are the prefixed selection ids the output belongs to and
    categories are the matching chip labels.

    selected_ids: set of prefixed chip ids ('gear:rings', 'tools:misc_crafted',
    'cons:cooking', 'mat:bar', ...); an output is included if any of its chip
    ids is selected. None (or empty) = include every craftable output.
    """
    if recipes_by_name is None:
        import util.walkscape_constants  # noqa: F401  (init order)
        from util.autogenerated.recipes import RECIPES_BY_NAME as recipes_by_name
    sel = set(selected_ids) if selected_ids else None
    out: List[Dict] = []
    seen_refs: Set[str] = set()
    for rname, recipe in recipes_by_name.items():
        ref = getattr(recipe, 'output_item', None)
        if not ref or ref in seen_refs:
            continue
        try:
            obj = recipe.get_output_item_object()
        except Exception:
            obj = None
        if obj is None:
            continue
        classified = _classify_output(ref, obj)
        if not classified:
            continue
        group, chips = classified
        ids = [c['id'] for c in chips]
        if sel is not None and not (set(ids) & sel):
            continue
        seen_refs.add(ref)
        out.append({
            'recipe_name': rname,
            'output_ref': ref,
            'output_name': getattr(obj, 'name', ref.split('.')[-1]),
            'group': group,
            'chip_ids': ids,
            'categories': [c['label'] for c in chips],
            'chips': chips,
        })
    out.sort(key=lambda r: r['output_name'])
    return out


def _recipe_output_index(recipes_by_name) -> Dict[str, object]:
    """ref -> recipe for every recipe output (first recipe wins on a dup ref)."""
    idx: Dict[str, object] = {}
    for recipe in recipes_by_name.values():
        ref = getattr(recipe, 'output_item', None)
        if ref and ref not in idx:
            idx[ref] = recipe
    return idx


def _craftable_name_to_ref(recipes_by_name) -> Dict[str, str]:
    """Output-object display name -> ref, over every recipe output. Bridges a
    recipe's input MaterialInstance (which exposes only `.name`) back to the ref
    of the recipe that produces it, so we can tell crafted inputs from raw
    gathered ones."""
    m: Dict[str, str] = {}
    for recipe in recipes_by_name.values():
        ref = getattr(recipe, 'output_item', None)
        if not ref:
            continue
        try:
            nm = getattr(recipe.get_output_item_object(), 'name', None)
        except Exception:
            nm = None
        if nm and nm not in m:
            m[nm] = ref
    return m


def _recipe_crafted_input_refs(recipe, name_to_ref) -> Set[str]:
    """Refs of a recipe's CRAFTABLE input materials (read from `recipe.materials`,
    a list of groups of (qty, MaterialInstance)). Raw gathered materials (logs,
    ores) produce no recipe output, so their name isn't in name_to_ref and they
    are excluded."""
    out: Set[str] = set()
    for group in (getattr(recipe, 'materials', None) or []):
        for entry in (group or []):
            mi = entry[1] if isinstance(entry, (tuple, list)) and len(entry) >= 2 else entry
            nm = getattr(mi, 'name', None)
            ref = name_to_ref.get(nm) if nm else None
            if ref:
                out.add(ref)
    return out


def intermediate_crafted_refs(output_refs, recipes_by_name=None) -> Set[str]:
    """The DIRECT crafted inputs of the given seed items (one level),
    EXCLUDING the seeds themselves — e.g. a toolbox's planks.

    These become their own output rows. We intentionally do NOT recurse: a
    plank's own inputs (logs, or Wood scrap via the "(Scrap)" route) are BASE
    materials the parent's crafting tree already handles — their fastest-to-
    obtain is the Fastest Target Items computation, reused as a subtree leaf —
    not separate recipe rows. This matches the user's model: 2 toolboxes + their
    2 planks = 26 visible cells, with no wood-scrap row.

    Only recipe outputs count as crafted inputs; raw gathered materials (logs,
    ores) and keyword inputs have no recipe and are excluded."""
    if recipes_by_name is None:
        import util.walkscape_constants  # noqa: F401  (init order)
        from util.autogenerated.recipes import RECIPES_BY_NAME as recipes_by_name
    out_idx = _recipe_output_index(recipes_by_name)
    name_to_ref = _craftable_name_to_ref(recipes_by_name)
    seeds = set(output_refs or ())
    result: Set[str] = set()
    for ref in seeds:
        recipe = out_idx.get(ref)
        if recipe is None:
            continue
        for iref in _recipe_crafted_input_refs(recipe, name_to_ref):
            if iref not in seeds:
                result.add(iref)
    return result


def _is_quality_bearing(output_ref) -> bool:
    """Only ``Item.*`` recipe outputs activate the solver's quality axis (the
    exact driver's apply_quality term is gated on item_id.startswith('Item.')).
    Materials and consumables are quality-inert, so all 6 qualities solve
    identically — we collapse them to a single Normal solve per variant."""
    return str(output_ref or '').startswith('Item.')


def _visible_cell_count(output_ref) -> int:
    """Number of RESULT cells (variant × quality) a solve produces for one
    output, matching what the user sees + the progress bar denominator:
      • quality-bearing Item: 6 normal qualities + 5 fine (fine@Normal is
        dropped — fine never beats normal at a Normal target) = 11.
      • material/consumable (quality-inert): one Normal solve per variant = 2."""
    if _is_quality_bearing(output_ref):
        return 2 * len(QUALITIES) - 1
    return len(VARIANTS)


# ── per-item solve (reuses the exact crafting-tree optimizer) ───────────────
def _force_auto(nodes) -> None:
    for n in nodes:
        if n.get('source_type') != 'bank':
            n.setdefault('gear_config', {})['mode'] = 'auto'


# ── leaf → canonical goals-report scope-key classifier (Phase 4 live) ───────
# A reused sub-result leaf is "subscribed" to the goals-report scope the detector
# actually emits for it. The ONLY sub-node materials that have a live goals-report
# scope are those that are GATHERED — i.e. dropped by some activity and
# classifiable by util.stats_report.target_items. Those map to the detector's
# ('target_items', group_slug, item_slug, 'NONE', 'NONE') key (gear-independent;
# location/service literal 'NONE'), byte-identical to what
# enumerate_applicable_sources / detect_stale_scopes produce. We key off the
# droppable universe (not the solved node's source_type) because the exact driver
# can leave a gather leaf tagged source_type='best' (observed on Volcanic rock),
# which an `== 'activity'` filter would silently miss. Crafted-only intermediates
# (Hardened kelp, Hydrilium) are NOT activity-dropped, so they are correctly absent
# from the index and contribute no key of their own — their staleness is inherited
# through their own gather children, which ARE in the index.
_TI_SCOPE_INDEX: Optional[Dict[str, tuple]] = None
_TI_FINE_SCOPE_INDEX: Optional[Dict[str, tuple]] = None


def _target_items_scope_index() -> Dict[str, tuple]:
    """ref -> (group_slug, item_slug) for every activity-droppable, classifiable
    material — the SAME universe enumerate_applicable_sources emits target_items
    scopes for. Cached. The base (non-fine) slug is kept (classify_drop_entry_all
    yields base before fine, so setdefault registers base first). The FINE slug
    per ref is captured in a parallel index (_TI_FINE_SCOPE_INDEX) so a
    fine-material gather can emit its own 'X (Fine)' target_items key."""
    global _TI_SCOPE_INDEX, _TI_FINE_SCOPE_INDEX
    if _TI_SCOPE_INDEX is not None:
        return _TI_SCOPE_INDEX
    idx: Dict[str, tuple] = {}
    fidx: Dict[str, tuple] = {}
    try:
        import util.walkscape_constants  # noqa: F401  (init order)
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
        from util.stats_report.target_items import classify_drop_entry_all
    except Exception:
        _TI_SCOPE_INDEX = {}
        _TI_FINE_SCOPE_INDEX = {}
        return _TI_SCOPE_INDEX
    for activity in ACTIVITIES_BY_NAME.values():
        drops = list(getattr(activity, 'drop_table', None) or []) + \
                list(getattr(activity, 'secondary_drop_table', None) or [])
        for d in drops:
            try:
                for (group_slug, item_slug, _name, ref, _is_fine) in \
                        classify_drop_entry_all(d, include_fine=True):
                    if ref:
                        if _is_fine:
                            fidx.setdefault(ref, (group_slug, item_slug))
                        else:
                            idx.setdefault(ref, (group_slug, item_slug))
            except Exception:
                continue
    _TI_SCOPE_INDEX = idx
    _TI_FINE_SCOPE_INDEX = fidx
    return idx


def _target_items_fine_scope_index() -> Dict[str, tuple]:
    """ref -> (group_slug, fine_item_slug) for materials with a fine variant.
    Built alongside the base index; empty for refs with no fine drop."""
    if _TI_FINE_SCOPE_INDEX is None:
        _target_items_scope_index()
    return _TI_FINE_SCOPE_INDEX or {}


def _reset_ti_scope_index():
    """Test hook: drop the cached target_items scope index (base + fine)."""
    global _TI_SCOPE_INDEX, _TI_FINE_SCOPE_INDEX
    _TI_SCOPE_INDEX = None
    _TI_FINE_SCOPE_INDEX = None


def pin_gather_reuse(nodes, gather_reuse, use_fine: bool = False) -> int:
    """fc-preopt A — make FC's gather leaves SHOW the Fastest Target Items
    number instead of the crafting-tree's own gather formula (the two diverge:
    bamboo-logs-fine is 475 here but 397 in the target-items report). For each
    gather (activity) leaf, resolve its material + fine-ness to a target_items
    scope key and, if the caller supplied a solved steps/item for that key, pin
    it on the node via `_fc_pinned_steps_per_item` (honored by
    calculate_node_metrics). calculate_tree then rolls the pinned value into the
    parent craft totals, so FC and the target-items report agree by construction
    and FC never re-solves a gather the target-items run already solved.

    gather_reuse: {"<group>::<item_slug>": steps} — the native target-items
    results (JSON-string keys so it round-trips through the browser payload).
    use_fine: the tree's variant — fine trees gather the FINE material, so a
    fine scope key is preferred when one exists. Returns the number pinned."""
    if not gather_reuse:
        return 0
    idx = _target_items_scope_index()         # ref -> (group, base_item_slug)
    fidx = _target_items_fine_scope_index()   # ref -> (group, fine_item_slug)
    pinned = 0
    for n in nodes:
        if n.get('source_type') != 'activity':
            continue
        ref = n.get('item_id')
        if not ref:
            continue
        key = None
        if use_fine:
            fk = fidx.get(ref)
            if fk and f"{fk[0]}::{fk[1]}" in gather_reuse:
                key = fk
        if key is None:
            bk = idx.get(ref)
            if bk:
                key = bk
        if key is None:
            continue
        s = gather_reuse.get(f"{key[0]}::{key[1]}")
        try:
            s = float(s) if s is not None else None
        except (TypeError, ValueError):
            s = None
        if s is not None and s > 0:
            n['_fc_pinned_steps_per_item'] = s
            pinned += 1
    return pinned


def gather_scope_keys_from_leaf_memo(leaf_memo, idx, fidx) -> Set[str]:
    """Canonical target_items scope keys for every gather leaf the run SOLVED.

    Each leaf_memo key is the tuple
    (ut, aid, item_ref, tgt, skill, loc, use_fine, is_fine_target, input).
    When the gather targeted the FINE variant (is_fine_target True) we emit the
    fine 'X (Fine)' scope key from `fidx`, so the Fastest Target Items section
    gets a 'Bamboo logs (Fine)' row — not just the base 'Bamboo logs'. Falls
    back to the base key when there's no fine entry for the ref."""
    keys: Set[str] = set()
    for _mk in (leaf_memo or {}):
        if not (isinstance(_mk, tuple) and len(_mk) > 2):
            continue
        _ref = _mk[2]
        if not _ref:
            continue
        _is_fine = bool(_mk[7]) if len(_mk) > 7 else False
        _hit = (fidx.get(_ref) if _is_fine else None) or idx.get(_ref)
        if _hit:
            keys.add(canonical_scope_key('target_items', _hit[0], _hit[1],
                                         'NONE', 'NONE'))
    return keys


def subtree_scope_keys_for_tree(nodes, root_id=None) -> List[str]:
    """Canonical goals-report scope keys for a solved tree's reused sub-results.

    Returns the sorted set of canonical ('target_items', group, item, 'NONE',
    'NONE') keys for every NON-root sub-node material that the goals report has a
    target_items scope for. These are exactly the keys the live stale detector
    (detect_stale_scopes) can flag, so fastest_craft_stale_items can OR them with
    the row's base-node key. Non-droppable (crafted-only) intermediates emit no
    key of their own; their staleness rides on their gather children."""
    if root_id is None:
        root = next((n for n in nodes if n.get('parent_id') in (None, '')), None)
        root_id = root.get('node_id') if root else None
    idx = _target_items_scope_index()
    keys: Set[str] = set()
    for n in nodes:
        if n.get('node_id') == root_id:
            continue
        ref = n.get('item_id')
        if not ref:
            continue
        hit = idx.get(ref)
        if hit:
            group_slug, item_slug = hit
            keys.add(canonical_scope_key('target_items', group_slug, item_slug,
                                         'NONE', 'NONE'))
    return sorted(keys)


def _capture_node_services(nodes):
    """{ref: {service_id, location_id}} for every solved node that resolved a
    crafting service or activity location — the FC solve's chosen service/
    location per node. Lets the "Crafting tree" button re-apply them on open so
    each node opens on the service/location the solve picked, without having to
    re-resolve it. Keyed by item_ref (unique per FC tree in practice)."""
    out = {}
    for n in nodes or ():
        ref = n.get('item_id')
        if not ref:
            continue
        svc = n.get('selected_service_id')
        loc = n.get('selected_location_id')
        if svc is None and loc is None:
            continue
        out[ref] = {'service_id': svc, 'location_id': loc}
    return out


def _tree_breakdown(nodes):
    """From a solved + calculated tree, return
    (root_self_steps, offsets, root_gearset_export, child_quantities).

    offsets maps each NON-root material ref ->
        {'needed': total units for ONE target, 'cum': cumulative steps per unit}
    which is exactly what the banked-materials deduction needs. root_self is the
    irreducible final-craft step cost (the banked floor)."""
    root = next((n for n in nodes if n.get('parent_id') in (None, '')), None)
    root_self = 0.0
    root_export = None
    child_q = {}
    root_id = root.get('node_id') if root else None
    if root is not None:
        m = root.get('metrics') or {}
        try:
            root_self = float(m.get('steps_per_item') or 0.0)
        except (TypeError, ValueError):
            root_self = 0.0
        root_export = (root.get('gear_config') or {}).get('optimized_export')
    try:
        from ui.crafting_tree_optimize import _cumulative_steps_per_item
        cum = _cumulative_steps_per_item(nodes)
    except Exception:
        cum = {}
    offsets = {}
    for n in nodes:
        if n.get('node_id') == root_id:
            continue
        ref = n.get('item_id')
        if not ref:
            continue
        try:
            needed = float(n.get('effective_quantity') or 0.0)
        except (TypeError, ValueError):
            needed = 0.0
        if needed <= 0:
            continue
        c = cum.get(n.get('node_id'))
        try:
            c = float(c) if c not in (None, float('inf')) else 0.0
        except (TypeError, ValueError):
            c = 0.0
        agg = offsets.setdefault(ref, {'needed': 0.0, 'cum': c})
        agg['needed'] += needed
        if c > agg['cum']:
            agg['cum'] = c
        if n.get('parent_id') == root_id:
            child_q[ref] = child_q.get(ref, 0.0) + needed
    return root_self, offsets, root_export, child_q


def compute_with_banked(total_steps, root_self, offsets, owned_counts):
    """Steps/craft after deducting owned/banked materials (R6).

    with_banked = max(root_self, total_steps - Σ min(owned[m], needed[m])·cum[m]).
    Owning materials lets you skip producing them, saving their cumulative
    per-unit steps; you can never go below the irreducible final-craft step."""
    if total_steps is None:
        return None
    saved = 0.0
    for ref, info in (offsets or {}).items():
        try:
            needed = float(info.get('needed', 0.0))
            cum = float(info.get('cum', 0.0))
        except (TypeError, ValueError):
            continue
        own = (owned_counts or {}).get(ref, 0)
        try:
            own = float(own)
        except (TypeError, ValueError):
            own = 0.0
        saved += min(own, needed) * cum
    return max(float(root_self or 0.0), float(total_steps) - saved)


def _fc_settings(quality: str, use_fine: bool, ui_config: dict = None,
                 fast: bool = False) -> dict:
    """Solve settings for one (variant, quality) cell. Buffer 0 / qty 1 makes
    summary.total_steps the clean per-one total."""
    gs = {'target_quality': quality, 'use_fine': use_fine,
          'skip_shops': True, 'skip_chests': True,
          'optimize_pets': False, 'optimize_consumables': False,
          'target_quantity': 1, 'buffer_percentage': 0.0,
          # FC's headline is FROM-SCRATCH steps/craft (owned inventory ignored);
          # the owned-subtracted number is derived separately by
          # compute_with_banked(total_steps, ...). calculate_tree defaults
          # use_owned_quantities ON, so leaving it unset made summary.total_steps
          # ALREADY owned-reduced — then compute_with_banked subtracted AGAIN
          # (double count), and a fully-owned chain collapsed to 0 which
          # _record_cell masks as None -> blank cell (pine planks/toolboxes).
          # Force it OFF so total_steps is the true from-scratch cost.
          'use_owned_quantities': False,
          'fast': bool(fast)}
    # fc-preopt A: carry the native target-items gather-steps map (set by
    # run_fastest_craft into ui_config) onto gs so _record_cell can pin gather
    # leaves. None/absent => no pinning (unchanged behavior).
    gs['_fc_gather_reuse'] = (ui_config or {}).get('_fc_gather_reuse')
    # fc-preopt C: when solving the grid cells, also SKIP the gear B&B for any
    # gather leaf whose number will be pinned — its solve result is discarded,
    # so running it only wastes time and re-solves shared gathers once per shard.
    gs['_fc_skip_pinned_gather_solve'] = bool((ui_config or {}).get('_fc_skip_pinned_gather_solve'))
    # Phase 1 service frontier: default OFF (2026-10-17). It was producing
    # inflated FC steps vs the trusted frontier-off calculate_tree engine the
    # column-3 crafting tree uses (bamboo plank 63.1 with frontier ON vs 44.2
    # OFF at matched quantity). Kept behind the flag for a proper per-survivor
    # service-pick audit before re-enabling; opt in via
    # ui_config.fc_service_frontier = true.
    # fc_service_frontier default flipped ON 2026-10-19 (fc-preopt Phase 2). The
    # historical inflation (plank 63.1 ON vs 44.2 OFF) no longer reproduces:
    # ON==OFF verified at every (variant,quality) for bamboo/pine. Still
    # overridable via ui_config.fc_service_frontier=false. FAC-gated on testing.
    gs['fc_service_frontier'] = bool((ui_config or {}).get('fc_service_frontier', True))
    return gs


def _record_cell(nodes, gs, gd, session_data, with_details):
    """calculate_tree a solved tree and return (total_steps|None, detail|None)."""
    from ui.crafting_tree import calculate_tree
    # fc-preopt A: pin gather leaves to the native Fastest-Target-Items steps
    # BEFORE calculate_tree rolls the tree up, so FC's gather nodes AND the
    # parent craft totals reflect the SAME number the target-items report shows
    # (the two gather formulas otherwise diverge). Every FC solve path (full,
    # cross-item reuse, root-only re-solve) funnels through here, so this one
    # spot covers them all. Map + variant arrive via gs (threaded from
    # run_fastest_craft through _fc_settings); absent => no-op (byte-identical).
    _gr = (gs or {}).get('_fc_gather_reuse')
    if _gr:
        try:
            pin_gather_reuse(nodes, _gr, use_fine=bool((gs or {}).get('use_fine')))
        except Exception:
            pass
    # FC scoring reads only summary.total_steps, never the available-sources
    # dropdown menus, so skip the per-call source-menu refresh — the single
    # biggest per-cell cost (~0.26s/cell profiled). (fc-preopt Phase 1 / 4e)
    calc = calculate_tree(nodes, gs, gd, session_data, refresh_sources=False)
    total = (calc.get('summary') or {}).get('total_steps')
    try:
        total = float(total) if total not in (None, float('inf')) else None
    except (TypeError, ValueError):
        total = None
    # A real from-scratch craft ALWAYS costs > 0 steps. A 0/negative total is a
    # degenerate/failed calc (seen as stored total=0.0 with empty offsets on
    # some PINE cells) — store None so the headline filter + stale/reuse logic
    # treat the cell as unsolved instead of surfacing a bogus "0 steps".
    if total is not None and total <= 0:
        total = None
    detail = None
    if with_details:
        root_self, offsets, root_export, child_q = _tree_breakdown(nodes)
        detail = {
            'total_steps': total, 'root_self': root_self,
            'offsets': offsets, 'base_gearset_export': root_export,
            'child_quantities': child_q,
            'subtree_scope_keys': subtree_scope_keys_for_tree(nodes),
            'node_services': _capture_node_services(nodes),
        }
    return total, detail


def _cell_degenerate(cell) -> bool:
    """True when a solved cell's total is missing/non-positive. A real craft
    never costs <= 0 steps, so this signals a failed/degenerate solve — e.g. a
    reuse/seed path that bailed under the browser node budget — that should be
    re-solved from scratch rather than stored/shown as a blank."""
    if not cell:
        return True
    t = cell[0]
    return t is None or not (isinstance(t, (int, float)) and t > 0)


def _solve_cell_full(output_ref, variant, quality, session_data, ui_config,
                     gd, log, with_details, compute_alternatives=True,
                     leaf_memo=None, fast=False):
    """Build + fully exact-solve one (variant, quality) cell from scratch."""
    from ui.crafting_tree import build_crafting_tree
    from ui.crafting_tree_exact_driver import optimize_tree_exact
    nodes = build_crafting_tree(output_ref, gd, session_data)
    _force_auto(nodes)
    gs = _fc_settings(quality, variant == 'fine', ui_config, fast=fast)
    optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                        ui_config or {}, log=log,
                        compute_alternatives=compute_alternatives,
                        leaf_memo=leaf_memo)
    return _record_cell(nodes, gs, gd, session_data, with_details)


def _assemble_result(out, details, with_details, output_ref=None) -> Dict:
    # Fine materials only raise QUALITY odds; at a NORMAL target they never beat
    # normal materials, so for a quality-bearing Item we drop the fine@Normal
    # cell (it would never win the headline and only adds a pointless row). This
    # does NOT apply to Material/Consumable outputs, where "fine" is a distinct
    # product (the fine material itself), not a quality aid.
    if output_ref and str(output_ref).startswith('Item.') and 'fine' in out:
        q0 = QUALITIES[0]  # 'Normal'
        if q0 in out['fine']:
            out['fine'][q0] = None
        if with_details and 'fine' in details and q0 in details['fine']:
            details['fine'][q0] = None
    headline = {}
    for q in QUALITIES:
        cands = [out[v][q] for v in VARIANTS if out[v].get(q) is not None]
        headline[q] = min(cands) if cands else None
    result = {'variants': out, 'headline': headline}
    if with_details:
        result['details'] = details
    return result


def _solve_item_all_qualities_full(output_ref: str, session_data: dict,
                                   ui_config: Optional[dict] = None,
                                   *, log=None, with_details=False,
                                   solve_progress=None) -> Dict:
    """Reference path: a full exact solve for every (variant, quality) cell.
    Same contract as solve_item_all_qualities; kept as the equivalence oracle."""
    if log is None:
        def log(*_a, **_k):
            pass
    from ui.crafting_tree import _load_game_data
    gd = _load_game_data()
    out: Dict[str, Dict[str, Optional[float]]] = {v: {} for v in VARIANTS}
    details: Dict[str, Dict[str, Optional[dict]]] = {v: {} for v in VARIANTS}
    is_item = _is_quality_bearing(output_ref)
    # Match solve_item_all_qualities' visible-cell shape: quality-inert outputs
    # collapse to a single Normal solve per variant.
    qualities = QUALITIES if is_item else [QUALITIES[0]]
    for variant in VARIANTS:
        for quality in qualities:
            # fine@Normal of a quality-bearing Item never wins (fine only raises
            # quality odds); skip so the oracle matches the reuse path exactly.
            if is_item and variant == 'fine' and quality == QUALITIES[0]:
                out[variant][quality] = None
                if with_details:
                    details[variant][quality] = None
                continue
            try:
                total, detail = _solve_cell_full(output_ref, variant, quality,
                                                 session_data, ui_config, gd,
                                                 log, with_details)
            except Exception as e:  # noqa: BLE001 — never crash the batch
                log(f"[fastest-craft] solve failed {output_ref} {variant}/{quality}: {e!r}")
                total, detail = None, None
            out[variant][quality] = total
            if with_details:
                details[variant][quality] = detail
            _tick(solve_progress)
    return _assemble_result(out, details, with_details, output_ref)


def _tick(solve_progress) -> None:
    if solve_progress is not None:
        try:
            solve_progress()
        except Exception:
            pass


# ── cross-item reuse: transplant a pre-solved crafted-input subtree ─────────
_SEED_ENGAGED: List[str] = []  # test observability: refs whose base solve was seeded


def _subtree_paths(nodes, root_id) -> Dict[str, tuple]:
    """node_id -> path tuple (item_ids from root_id down to the node, inclusive)
    for every node in root_id's subtree. Used to match a freshly-built subtree
    against a captured, already-solved one so gearsets can be transplanted."""
    by_parent: Dict[str, list] = {}
    for n in nodes:
        by_parent.setdefault(n.get('parent_id'), []).append(n)
    root = next((n for n in nodes if n.get('node_id') == root_id), None)
    out: Dict[str, tuple] = {}
    if root is None:
        return out
    stack = [(root, (root.get('item_id'),))]
    while stack:
        node, path = stack.pop()
        out[node.get('node_id')] = path
        for ch in by_parent.get(node.get('node_id'), []):
            stack.append((ch, path + (ch.get('item_id'),)))
    return out


def _capture_subtree_gear(nodes, root_id):
    """path tuple -> optimized_export for every node in root_id's subtree.
    Returns None if two nodes share a path (ambiguous siblings) — then the
    subtree can't be transplanted by path and cross-item reuse is skipped."""
    paths = _subtree_paths(nodes, root_id)
    by_id = {n.get('node_id'): n for n in nodes}
    gear: Dict[tuple, object] = {}
    for nid, p in paths.items():
        if p in gear:
            return None
        gear[p] = ((by_id[nid].get('gear_config') or {}).get('optimized_export'))
    return gear


def solve_item_all_qualities(output_ref: str, session_data: dict,
                             ui_config: Optional[dict] = None,
                             *, log=None, with_details=False,
                             solve_progress=None, child_memo=None,
                             capture_reuse=False, leaf_memo=None,
                             fast=False) -> Dict:
    """Solve one craftable item across both material variants and all 6
    qualities using the EXACT optimizer.

    Per variant the whole tree is solved ONCE (at Normal); every other quality
    re-solves only the root node, reusing the quality-invariant child solves
    (only the root activates the quality axis). Slot alternatives are skipped:
    nothing here reads them and they dominate solve time. Any cell whose reuse
    is not provably safe or fails falls back to a full solve, so results are
    identical to _solve_item_all_qualities_full. solve_progress fires once per
    (variant, quality) cell.

    Returns {variants: {variant: {quality: total_steps_per_craft|None}},
             headline: {quality: min across variants}}. When with_details, also
    returns {details: {variant: {quality: {total_steps, root_self, offsets,
    base_gearset_export, child_quantities, subtree_scope_keys}|None}}} for
    persistence + the banked calc.

    total_steps_per_craft is the FULL per-one tree total (gather + intermediates
    + final craft) from calculate_tree's summary with buffer disabled — NOT the
    root's local step cost."""
    if log is None:
        def log(*_a, **_k):
            pass
    from ui.crafting_tree import build_crafting_tree, _load_game_data, descendant_ids
    from ui.crafting_tree_exact_driver import optimize_tree_exact, optimize_root_only
    gd = _load_game_data()
    out: Dict[str, Dict[str, Optional[float]]] = {v: {} for v in VARIANTS}
    details: Dict[str, Dict[str, Optional[dict]]] = {v: {} for v in VARIANTS}
    reuse_out: Dict[str, dict] = {}

    is_item = _is_quality_bearing(output_ref)
    # Quality-inert outputs (materials/consumables) collapse to the base solve:
    # all 6 qualities are identical for them, so only the base (Normal) cell is
    # solved per variant (user 2026-10-09: planks = 2 variants, no quality loop).
    tail_qualities = QUALITIES[1:] if is_item else []
    memo = child_memo or {}

    def _full(variant, quality):
        try:
            return _solve_cell_full(output_ref, variant, quality, session_data,
                                    ui_config, gd, log, with_details,
                                    compute_alternatives=False,
                                    leaf_memo=leaf_memo, fast=fast)
        except Exception as e:  # noqa: BLE001 — never crash the batch
            log(f"[fastest-craft] solve failed {output_ref} {variant}/{quality}: {e!r}")
            return None, None

    def _seeded_base(variant, use_fine, base_quality):
        """CROSS-ITEM reuse: solve the base cell by transplanting pre-solved
        crafted-child subtrees (from `memo`) and seeding their cumulative steps,
        so a child's branch-and-bound is NOT re-run. Returns (nodes, cum, cell)
        or None to signal a full-solve fallback. Safe by the kelp parity proof
        (a child's gearset is identical standalone vs in-tree) + the exact
        structural path match below; any mismatch/failure falls back, so the
        numbers can never regress."""
        if not memo:
            return None
        try:
            nodes = build_crafting_tree(output_ref, gd, session_data)
            _force_auto(nodes)
            root = next((n for n in nodes if n.get('parent_id') in (None, '')), None)
            if root is None:
                return None
            root_id = root.get('node_id')
            by_id = {n.get('node_id'): n for n in nodes}
            # Direct crafted children of the root we have a captured solve for.
            sealed_roots = [n for n in nodes
                            if n.get('parent_id') == root_id
                            and (n.get('item_id'), variant) in memo
                            and memo[(n.get('item_id'), variant)].get('gear') is not None]
            if not sealed_roots:
                return None
            scope_out: Set[str] = set()
            cum_seed: Dict[str, float] = {}
            for sr in sealed_roots:
                srid = sr.get('node_id')
                mem = memo[(sr.get('item_id'), variant)]
                # Structural identity: the fresh subtree's path set must equal
                # the captured one (differs if routes resolved differently) —
                # else fall back rather than risk wrong numbers.
                path_to_id: Dict[tuple, str] = {}
                for nid, p in _subtree_paths(nodes, srid).items():
                    if p in path_to_id:
                        return None                      # ambiguous siblings
                    path_to_id[p] = nid
                if set(path_to_id) != set(mem['gear']):
                    return None
                for p, nid in path_to_id.items():        # transplant gearsets
                    gc = by_id[nid].setdefault('gear_config', {})
                    exp = mem['gear'][p]
                    if exp is not None:
                        gc['optimized_export'] = exp
                    else:
                        gc.pop('optimized_export', None)
                scope_out |= descendant_ids(nodes, srid)
                scope_out.add(srid)
                cum_seed[srid] = mem['cum']
            scope_ids = {n.get('node_id') for n in nodes} - scope_out
            gs = _fc_settings(base_quality, use_fine, ui_config, fast=fast)
            diag = optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                                       ui_config or {}, log=log, return_cum=True,
                                       compute_alternatives=False,
                                       scope_ids=scope_ids, cum_seed=cum_seed,
                                       leaf_memo=leaf_memo)
            cell = _record_cell(nodes, gs, gd, session_data, with_details)
            if cell[0] is None:
                return None
            _SEED_ENGAGED.append(output_ref)
            return nodes, diag.get('cum'), cell
        except Exception as e:  # noqa: BLE001 — any failure -> full-solve fallback
            log(f"[fastest-craft] seeded base solve failed {output_ref} {variant}: {e!r}")
            return None

    for variant in VARIANTS:
        use_fine = (variant == 'fine')
        base_quality = QUALITIES[0]
        nodes = None
        cum = None
        seeded = _seeded_base(variant, use_fine, base_quality)
        if seeded is not None:
            nodes, cum, cell = seeded
        else:
            try:
                nodes = build_crafting_tree(output_ref, gd, session_data)
                _force_auto(nodes)
                # A Best(auto) Item root picks its route under the target quality
                # (the quality axis only applies to Item.* roots), so its subtree
                # is not quality-invariant; such items solve every cell fully.
                built_root = next((n for n in nodes if n.get('parent_id') in (None, '')), None)
                reusable = (built_root is not None
                            and not (built_root.get('source_type') == 'best'
                                     and str(built_root.get('item_id') or '').startswith('Item.')))
                gs = _fc_settings(base_quality, use_fine, ui_config, fast=fast)
                diag = optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                                           ui_config or {}, log=log, return_cum=True,
                                           compute_alternatives=False,
                                           leaf_memo=leaf_memo)
                cum = diag.get('cum') if reusable else None
                cell = _record_cell(nodes, gs, gd, session_data, with_details)
            except Exception as e:  # noqa: BLE001
                log(f"[fastest-craft] solve failed {output_ref} {variant}/{base_quality}: {e!r}")
                cell = (None, None)
                cum = None
        # Degenerate-cell guard: a reuse/seed path can yield a 0/None total
        # (browser node-budget bail) while a clean full solve is correct. Re-solve
        # full and drop the (bad) seed so tail qualities don't inherit it.
        if _cell_degenerate(cell):
            cell = _full(variant, base_quality)
            cum = None
        out[variant][base_quality] = cell[0]
        if with_details:
            details[variant][base_quality] = cell[1]
        # Tick only VISIBLE cells. The fine-variant base (Normal) solve of a
        # quality-bearing Item is only a seed for the fine Good..Eternal
        # re-solves (nulled in _assemble_result), so it is not counted.
        if (not is_item) or (variant != 'fine'):
            _tick(solve_progress)

        # Capture this solved subtree so a later PARENT can reuse it cross-item.
        if capture_reuse and cum is not None and nodes is not None:
            try:
                rid = next((n['node_id'] for n in nodes
                            if n.get('parent_id') in (None, '')), None)
                g = _capture_subtree_gear(nodes, rid) if rid else None
                if g is not None and rid in cum:
                    reuse_out[variant] = {'cum': cum[rid], 'gear': g}
            except Exception:
                pass

        for quality in tail_qualities:
            cell = None
            if cum is not None:
                try:
                    gs = _fc_settings(quality, use_fine, ui_config, fast=fast)
                    if optimize_root_only('fastest-craft', nodes, gs, session_data,
                                          ui_config or {}, cum, log=log,
                                          compute_alternatives=False,
                                          leaf_memo=leaf_memo) is not None:
                        cell = _record_cell(nodes, gs, gd, session_data, with_details)
                except Exception as e:  # noqa: BLE001
                    log(f"[fastest-craft] root re-solve failed {output_ref} "
                        f"{variant}/{quality}, full solve instead: {e!r}")
                    cell = None
            if cell is None or _cell_degenerate(cell):
                cell = _full(variant, quality)
            out[variant][quality] = cell[0]
            if with_details:
                details[variant][quality] = cell[1]
            _tick(solve_progress)
    result = _assemble_result(out, details, with_details, output_ref)
    if capture_reuse:
        result['reuse'] = reuse_out
    return result


def _owned_equal(a, b):
    """Numeric-tolerant equality of two owned-count maps (JSON ints vs live)."""
    for k in set(a or {}) | set(b or {}):
        try:
            if float((a or {}).get(k, 0) or 0) != float((b or {}).get(k, 0) or 0):
                return False
        except (TypeError, ValueError):
            if (a or {}).get(k) != (b or {}).get(k):
                return False
    return True


def _base_scope_for_recipe(recipe_name, char_config) -> Optional[Dict]:
    """Derive the base/final-craft node's dominance scope for a crafted item's
    recipe: {skill, location, service, quality_mode}. Uses the SAME
    representative recipe location/service resolver the goals-report stale
    detector uses for chests_recipes, so the scope is well-formed. Captured ONCE
    at solve and stored; recompute reuses the stored scope verbatim so only the
    character's gear can move the bitmap (no false-positive badge storm).
    Returns None if the recipe or its service isn't resolvable/unlocked."""
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.recipes import RECIPES_BY_NAME
        from util.stats_report.applicable_sources import (
            representative_recipe_service_location, _resolve_accessibility)
        from util.stats_report.state_snapshot import from_char_config
        try:
            from util.autogenerated.services import SERVICES_BY_NAME
        except Exception:
            SERVICES_BY_NAME = {}
    except Exception:
        return None
    recipe = RECIPES_BY_NAME.get(recipe_name)
    if recipe is None:
        return None
    skill = getattr(recipe, 'skill', None)
    skill = (skill if isinstance(skill, str) else getattr(skill, 'name', '')).lower()
    if not skill:
        return None
    try:
        snap = from_char_config(char_config or {}, {})
        unlocked, locked = _resolve_accessibility(char_config or {})
        loc, svc = representative_recipe_service_location(
            recipe, snap, unlocked, locked, SERVICES_BY_NAME)
    except Exception:
        return None
    if loc is None:
        return None
    return {'skill': skill, 'location': loc, 'service': svc or 'NONE',
            'quality_mode': 'recipe_quality'}


def base_dominance_bitmap(snapshot, scope, db) -> Optional[str]:
    """Hex-encoded dominance bitmap for a base-node scope under a given
    character snapshot. The quality/variant-invariant crafting-gear pool for the
    recipe's (skill, location, service) at recipe_quality mode. Returns None on
    any failure (treated as 'no base signal', never flags)."""
    if not scope:
        return None
    try:
        from util.stats_report.effective_bitmap import compute_effective_owned_bitmap
        bm = compute_effective_owned_bitmap(
            snapshot, scope.get('skill'), scope.get('location'),
            scope.get('service', 'NONE'), scope.get('quality_mode', 'recipe_quality'),
            db=db, required_keywords=None)
        if isinstance(bm, (bytes, bytearray)):
            return bytes(bm).hex()
    except Exception:
        return None
    return None


def persist_fastest_craft(db, session_uuid, item_ref, details, owned_counts=None,
                          *, base_scope=None, base_bitmap=None, session_data=None):
    """Write every (variant, quality) detail row for one item, computing the
    banked step count from the owned counts. Returns the number of rows written.

    The FINE variant deducts (and snapshots) FINE stock for its fine-capable
    materials — a fine tree consumes fine logs, so normal-log stock must not
    credit against it. When `session_data` is supplied the fine owned map is
    resolved per fine variant; otherwise it falls back to `owned_counts` (normal)
    for both variants (legacy behavior)."""
    owned_counts = owned_counts or {}
    written = 0
    for variant, qmap in (details or {}).items():
        for quality, d in (qmap or {}).items():
            if not d:
                continue
            offsets = d.get('offsets') or {}
            # Fine variant: resolve fine-aware owned for this cell's materials so
            # the banked math and the (i) tooltip both reflect fine stock.
            if variant == 'fine' and session_data is not None:
                oc = owned_counts_for_refs(list(offsets.keys()), session_data,
                                           use_fine=True)
            else:
                oc = owned_counts
            banked = compute_with_banked(d.get('total_steps'), d.get('root_self'),
                                         offsets, oc)
            needed_owned = {ref: oc.get(ref, 0) for ref in offsets}
            db.upsert_fastest_craft_result(
                session_uuid, item_ref, variant, quality,
                base_gearset_export=d.get('base_gearset_export'),
                total_steps=d.get('total_steps'), with_banked_steps=banked,
                root_self_steps=d.get('root_self'),
                child_quantities=d.get('child_quantities'),
                material_offsets=offsets, needed_owned_counts=needed_owned,
                subtree_scope_keys=d.get('subtree_scope_keys'),
                base_dominance_bitmap=base_bitmap, base_scope=base_scope,
                node_services=d.get('node_services'))
            written += 1
    return written


def refresh_banked_if_stale(db, session_uuid, owned_counts, item_refs=None,
                            *, session_data=None):
    """Page-load recompute (R6): for each stored row whose owned-count snapshot
    (restricted to that item's materials) no longer matches the current owned
    counts, recompute the banked step count from the STORED material offsets
    (pure arithmetic, no re-solve) and update it. Returns the number of rows
    updated. Rows whose relevant owned counts are unchanged are left untouched.

    FINE rows use FINE-resolved owned counts (a fine tree consumes fine logs) so
    the banked math + the (i) tooltip agree. Needs `session_data` to resolve the
    fine map; without it, fine rows fall back to `owned_counts` (legacy)."""
    owned_counts = owned_counts or {}
    rows = db.get_fastest_craft_results(session_uuid, item_refs)
    updated = 0
    for row in rows:
        offsets = row.get('material_offsets') or {}
        if row.get('variant') == 'fine' and session_data is not None:
            oc = owned_counts_for_refs(list(offsets.keys()), session_data,
                                       use_fine=True)
        else:
            oc = owned_counts
        stored = row.get('needed_owned_counts') or {}
        cur = {ref: oc.get(ref, 0) for ref in offsets}
        if _owned_equal(cur, stored):
            continue
        banked = compute_with_banked(row.get('total_steps_per_craft'),
                                     row.get('root_self_steps'), offsets, oc)
        db.update_fastest_craft_banked(session_uuid, row['item_ref'], row['variant'],
                                       row['quality'], banked, cur)
        updated += 1
    return updated


def owned_counts_for_refs(refs, session_data, use_fine: bool = False) -> Dict:
    """Resolve owned stock per material ref from the session inventory, bridging
    the goals-report owned_quantities slug map (keyed by item-name slug) to the
    Material.*/Consumable.* refs the banked calc keys on. Reuses the crafting
    tree's authoritative resolver so Fastest Craft banked deductions match the
    'use banked materials' feature exactly. Returns {} when no inventory."""
    try:
        from ui.crafting_tree import _owned_quantity_for_ref
    except Exception:
        return {}
    out: Dict[str, int] = {}
    for ref in refs or ():
        if not ref:
            continue
        try:
            out[ref] = _owned_quantity_for_ref(ref, session_data, use_fine)
        except Exception:
            out[ref] = 0
    return out


def _refs_in_details(details) -> Set[str]:
    """Union of every material-offset ref across an item's (variant, quality)
    detail breakdown — the refs the banked calc can deduct owned stock for."""
    refs: Set[str] = set()
    for qmap in (details or {}).values():
        for d in (qmap or {}).values():
            if d:
                refs |= set((d.get('offsets') or {}).keys())
    return refs


def build_preview_tree(output_ref: str, session_data: dict,
                       ui_config: Optional[dict] = None, *,
                       quality: str = 'Normal', variant: str = 'normal',
                       log=None) -> Optional[Dict]:
    """Build a nested preview tree for one craftable item at a (quality, variant)
    using the EXACT optimizer, for the Phase 5 preview (R8 / task 5.7).

    Returns a recursive dict:
        {item_ref, name, icon, qty, steps_per_item, source_type, children:[...]}
    where qty is the per-one-target required units and steps_per_item is the
    node's local steps/output. None if the item can't be built."""
    if log is None:
        def log(*_a, **_k):
            pass
    from ui.crafting_tree import (build_crafting_tree, calculate_tree,
                                  _load_game_data)
    from ui.crafting_tree_exact_driver import optimize_tree_exact
    gd = _load_game_data()
    nodes = build_crafting_tree(output_ref, gd, session_data or {})
    _force_auto(nodes)
    gs = {'target_quality': quality, 'use_fine': (variant == 'fine'),
          'skip_shops': True, 'skip_chests': True, 'optimize_pets': False,
          'optimize_consumables': False, 'target_quantity': 1,
          'buffer_percentage': 0.0,
          # From-scratch preview (owned ignored) so the breakdown matches the
          # grid's from-scratch total and shows the full material requirement
          # (e.g. "still needs fine pine planks") regardless of current stock.
          'use_owned_quantities': False}
    optimize_tree_exact('fastest-craft-preview', nodes, gs, session_data or {},
                        ui_config or {}, log=log)
    calculate_tree(nodes, gs, gd, session_data or {}, refresh_sources=False)
    by_parent: Dict = {}
    root = None
    for n in nodes:
        pid = n.get('parent_id')
        if pid in (None, ''):
            root = n
        by_parent.setdefault(pid, []).append(n)
    if root is None:
        return None

    def _node(n):
        m = n.get('metrics') or {}
        try:
            spi = float(m.get('steps_per_item')) if m.get('steps_per_item') is not None else None
        except (TypeError, ValueError):
            spi = None
        try:
            qty = float(n.get('effective_quantity')) if n.get('effective_quantity') is not None else None
        except (TypeError, ValueError):
            qty = None
        return {
            'item_ref': n.get('item_id'),
            'name': n.get('item_name'),
            'icon': n.get('icon_path'),
            'qty': qty,
            'steps_per_item': spi,
            'source_type': n.get('source_type'),
            'children': [_node(c) for c in by_parent.get(n.get('node_id'), [])],
        }
    return _node(root)


def preview_tree_from_stored(session_uuid: str, item_ref: str, variant: str,
                             quality: str, session_data: dict, db) -> Optional[Dict]:
    """Assemble the Preview mini-tree from a STORED fastest_craft_results row —
    NO re-optimization (the fast path for the per-row Preview button).

    The tree STRUCTURE comes from build_crafting_tree (catalog expansion, cheap);
    each node's steps/item + qty come from the stored material_offsets
    (cum / needed) and the root's root_self_steps. Same nested shape as
    build_preview_tree. Returns None when no stored row matches the
    (variant, quality) — the caller then falls back to the live optimizer.

    Numbers reflect the solve that produced the stored row; the structure is the
    catalog default route, so a node the solve did not touch simply has no
    steps/qty (rendered blank). Exact for default-route items (the common case)."""
    try:
        rows = db.get_fastest_craft_results(session_uuid, [item_ref]) or []
    except Exception:
        return None
    want_v = 'fine' if variant == 'fine' else 'normal'
    row = next((r for r in rows if r.get('item_ref') == item_ref
                and r.get('variant') == want_v and r.get('quality') == quality), None)
    if row is None:
        row = next((r for r in rows if r.get('item_ref') == item_ref
                    and r.get('variant') == want_v), None)
    if row is None:
        row = next((r for r in rows if r.get('item_ref') == item_ref), None)
    if row is None:
        return None
    offs = row.get('material_offsets') or {}

    def _num(x):
        try:
            v = float(x)
        except (TypeError, ValueError):
            return None
        return v if (v == v and v != float('inf')) else None

    root_self = _num(row.get('root_self_steps'))
    # A degenerate stored cell (total 0/None, usually paired with empty offsets)
    # has no usable per-node data — returning it would render blank steps/item on
    # the children. Signal a live rebuild instead (caller re-solves), which is
    # validated to produce correct per-node numbers.
    _tot = _num(row.get('total_steps_per_craft'))
    if _tot is None or _tot <= 0 or root_self is None or root_self <= 0:
        return None
    # Build the preview from the STORED solve itself (not build_crafting_tree's
    # DEFAULT route): each cell's child_quantities (ref-keyed) gives the children
    # the solve actually used, and the root's FLAT material_offsets give every
    # material's cum (per-item steps). This matches the solved route — e.g. a
    # normal pine plank made from WOOD SCRAP shows wood scrap, not the default
    # pine-logs route (which the solve didn't pick, so its node rendered blank).
    try:
        from ui.crafting_tree import _resolve_item_ref, _get_icon_path_for_ref
    except Exception:
        _resolve_item_ref = None
        _get_icon_path_for_ref = None

    def _nm(ref):
        try:
            o = _resolve_item_ref(ref) if _resolve_item_ref else None
            return getattr(o, 'name', None) or ref.split('.')[-1].replace('_', ' ').title()
        except Exception:
            return str(ref).split('.')[-1].replace('_', ' ').title()

    def _ic(ref):
        try:
            return _get_icon_path_for_ref(ref) if _get_icon_path_for_ref else None
        except Exception:
            return None

    _cellcache: Dict[str, Optional[dict]] = {item_ref: row}

    def _cell_for(ref):
        if ref in _cellcache:
            return _cellcache[ref]
        try:
            rs = db.get_fastest_craft_results(session_uuid, [ref]) or []
        except Exception:
            rs = []
        c = (next((r for r in rs if r.get('variant') == want_v
                   and r.get('quality') == 'Normal'), None)
             or next((r for r in rs if r.get('variant') == want_v), None)
             or (rs[0] if rs else None))
        _cellcache[ref] = c
        return c

    def _emit(ref, qty, is_root, seen):
        steps = root_self if is_root else _num((offs.get(ref) or {}).get('cum'))
        children = []
        if ref not in seen:
            seen = seen | {ref}
            cell = row if is_root else _cell_for(ref)
            cq = (cell.get('child_quantities') if cell else None) or {}
            for cref, cneeded in cq.items():
                children.append(_emit(cref, _num(cneeded), False, seen))
        return {
            'item_ref': ref,
            'name': _nm(ref),
            'icon': _ic(ref),
            'qty': 1.0 if is_root else qty,
            'steps_per_item': steps,
            'source_type': None,
            'children': children,
        }
    return _emit(item_ref, 1.0, True, set())


def _preview_tree_from_stored_DEPRECATED(offs, root_self, _num):
    """Old default-route assembler, replaced by the solved-route recursion."""
    try:
        from ui.crafting_tree import build_crafting_tree, _load_game_data
        gd = _load_game_data()
        nodes = build_crafting_tree('', gd, {})
    except Exception:
        return None
    if not nodes:
        return None
    by_parent: Dict = {}
    root = None
    for n in nodes:
        pid = n.get('parent_id')
        if pid in (None, ''):
            root = n
        by_parent.setdefault(pid, []).append(n)
    if root is None:
        return None

    def _emit(n, is_root):
        ref = n.get('item_id')
        o = offs.get(ref) or {}
        return {
            'item_ref': ref,
            'name': n.get('item_name'),
            'icon': n.get('icon_path'),
            'qty': 1.0 if is_root else _num(o.get('needed')),
            'steps_per_item': root_self if is_root else _num(o.get('cum')),
            'source_type': n.get('source_type'),
            'children': [_emit(c, False) for c in by_parent.get(n.get('node_id'), [])],
        }
    return _emit(root, True)


def material_usage_tree(item_ref: str, session_data: dict,
                        db=None, session_uuid: str = None) -> Dict:
    """Nested recipe material breakdown for the "with owned materials" (i) popup,
    keyed by {variant: {quality: [nodes]}} so the tooltip can show the EXACT
    numbers for whichever (variant, quality) the row currently displays.

    Each node is {ref, name, needed, owned, enough, children}:
      • `needed` is the TOTAL units of that material the whole craft consumes
        (the stored cell's material_offsets[ref].needed — the grand total for one
        target, NOT the per-single-craft recipe amount), so the toolbox shows
        e.g. "10x Pine plank", then its full log total beneath it.
      • `owned` is the player's stock for the variant actually in use — the FINE
        stock for a fine-capable material in the FINE breakdown (so a fine row
        shows fine counts, not normal ones), normal stock otherwise.
      • `enough` is owned >= needed (lets the UI flag a shortfall and show the
        children that make up the deficit).

    Built from the SOLVED stored cells (variant/quality specific, solved route),
    so it matches the preview + headline exactly. Falls back to the catalog
    per-parent breakdown (normal/Normal only) when there are no stored rows."""
    # Fallback: catalog structure (per-parent amounts, normal owned). Used when
    # the DB/stored cells aren't available (e.g. unit tests, pre-solve).
    if db is None or not session_uuid:
        legacy = _material_usage_tree_catalog(item_ref, session_data)
        return {'normal': {'Normal': legacy}} if legacy else {}
    try:
        root_rows = db.get_fastest_craft_results(session_uuid, [item_ref]) or []
    except Exception:
        root_rows = []
    if not root_rows:
        legacy = _material_usage_tree_catalog(item_ref, session_data)
        return {'normal': {'Normal': legacy}} if legacy else {}
    # Gather every material ref the item's cells reference (flat offsets union),
    # then fetch ALL their cells in one call so child recursion needs no extra
    # per-ref DB round-trips.
    mat_refs: Set[str] = set()
    for r in root_rows:
        for mref in (r.get('material_offsets') or {}).keys():
            if mref:
                mat_refs.add(mref)
    try:
        child_rows = (db.get_fastest_craft_results(session_uuid, list(mat_refs))
                      if mat_refs else [])
    except Exception:
        child_rows = []
    # Index cells by (ref, variant, quality) and (ref, variant) for fallback.
    by_rvq: Dict[tuple, dict] = {}
    by_rv: Dict[tuple, dict] = {}
    for r in list(root_rows) + list(child_rows):
        ref = r.get('item_ref'); v = r.get('variant'); q = r.get('quality')
        by_rvq.setdefault((ref, v, q), r)
        by_rv.setdefault((ref, v), r)

    def _cell(ref, variant, quality):
        return (by_rvq.get((ref, variant, quality))
                or by_rvq.get((ref, variant, 'Normal'))
                or by_rv.get((ref, variant))
                or by_rv.get((ref, 'normal')))

    try:
        from ui.crafting_tree import _resolve_item_ref
    except Exception:
        _resolve_item_ref = None

    def _nm(ref, is_fine):
        base = None
        try:
            o = _resolve_item_ref(ref) if _resolve_item_ref else None
            base = getattr(o, 'name', None)
        except Exception:
            base = None
        base = base or str(ref).split('.')[-1].replace('_', ' ').title()
        return f"{base} (Fine)" if is_fine else base

    def _int(x):
        try:
            return int(round(float(x)))
        except (TypeError, ValueError):
            return 0

    # Which (variant, quality) combos the item actually has rows for.
    combos = {(r.get('variant'), r.get('quality')) for r in root_rows}
    out: Dict[str, Dict[str, List[Dict]]] = {}
    for variant, quality in combos:
        root = _cell(item_ref, variant, quality)
        if not root:
            continue
        offs = root.get('material_offsets') or {}
        owned = owned_counts_for_refs(list(offs.keys()), session_data,
                                      use_fine=(variant == 'fine')) or {}

        def _emit(ref, seen):
            agg = offs.get(ref) or {}
            needed = _int(agg.get('needed'))
            own = int(owned.get(ref, 0) or 0)
            # A fine-capable material shows its FINE name + fine stock in a fine
            # breakdown; a crafted intermediate (no fine variant) keeps normal.
            node = {
                'ref': ref,
                'name': _nm(ref, variant == 'fine' and _fine_variant_exists(ref)),
                'needed': needed,
                'owned': own,
                'enough': own >= needed if needed > 0 else True,
                'children': [],
            }
            if ref not in seen:
                seen = seen | {ref}
                cell = _cell(ref, variant, quality)
                cq = (cell.get('child_quantities') if cell else None) or {}
                for cref in cq.keys():
                    node['children'].append(_emit(cref, seen))
            return node

        cq0 = (root.get('child_quantities') or {})
        nodes = [_emit(cref, {item_ref}) for cref in cq0.keys()]
        if nodes:
            out.setdefault(variant, {})[quality] = nodes
    return out


def _fine_variant_exists(ref: str) -> bool:
    """True when `ref` is a Material.* with a resolvable _FINE variant."""
    try:
        from ui.crafting_tree import _rewrite_to_fine
        return _rewrite_to_fine(ref, True) != ref
    except Exception:
        return False


def _material_usage_tree_catalog(item_ref: str, session_data: dict) -> List[Dict]:
    """Nested recipe material breakdown for the "with owned materials" (i) popup.

    Returns the root item's crafted/gather inputs as a nested list
    [{ref, name, per_craft, owned, children:[...]}], recursing. `per_craft` is
    the per-PARENT recipe quantity (build_crafting_tree base_requirement_amount —
    e.g. toolbox needs 5 planks, a plank needs 2 logs); `owned` is the player's
    current stock for that material. Structure is catalog-only (owned-independent)
    so the (i) always appears, with or without owned stock."""
    try:
        from ui.crafting_tree import build_crafting_tree, _load_game_data
        gd = _load_game_data()
        nodes = build_crafting_tree(item_ref, gd, session_data or {})
    except Exception:
        return []
    if not nodes:
        return []
    by_parent: Dict = {}
    root = None
    for n in nodes:
        pid = n.get('parent_id')
        if pid in (None, ''):
            root = n
        by_parent.setdefault(pid, []).append(n)
    if root is None:
        return []
    refs = [n.get('item_id') for n in nodes if n.get('item_id')]
    try:
        owned = owned_counts_for_refs(refs, session_data) or {}
    except Exception:
        owned = {}

    def _q(x):
        try:
            return int(round(float(x)))
        except (TypeError, ValueError):
            return None

    def _emit(n):
        ref = n.get('item_id')
        return {
            'ref': ref,
            'name': n.get('item_name'),
            'per_craft': _q(n.get('base_requirement_amount')),
            'owned': int(owned.get(ref, 0) or 0),
            'children': [_emit(c) for c in by_parent.get(n.get('node_id'), [])],
        }
    return [_emit(c) for c in by_parent.get(root.get('node_id'), [])]


def build_fastest_craft_tree(output_ref: str, session_data: dict,
                             ui_config: Optional[dict] = None, *,
                             quality: str = 'Normal', variant: str = 'normal',
                             name: Optional[str] = None, log=None,
                             gather_reuse: Optional[dict] = None,
                             db=None, session_uuid: Optional[str] = None) -> Dict:
    """Build + exact-optimize the crafting tree for one item at a
    (quality, variant) and return it in the SAME shape the crafting-tree view
    saves/loads ({nodes, global_settings, summary}) WITHOUT persisting. Lets the
    "Crafting tree" button open the FC-solved tree (gearsets/locations/services
    intact) transiently, instead of re-optimizing from scratch (which produced a
    different gearset) or cluttering saved_crafting_trees on every click.
    Returns {tree_data, name, target_item_id}.

    GATHER-PULL (db + session_uuid + gather_reuse): the gathers were already
    solved as Fastest Target Items, so instead of re-running their expensive
    gear branch-and-bound we SKIP it (same fc-preopt flags the grid uses) and
    transplant each gather's STORED target-items gearset onto its node for
    display. Only engages when EVERY gather leaf has a stored gearset to show
    (else it falls back to solving gathers, so a gather can never render blank).
    Craft nodes still solve (cheap + deterministic; their route must be
    resolved, which needs the gear compare)."""
    if log is None:
        def log(*_a, **_k):
            pass
    from ui.crafting_tree import (build_crafting_tree, calculate_tree,
                                  _load_game_data, _resolve_item_ref)
    from ui.crafting_tree_exact_driver import optimize_tree_exact
    gd = _load_game_data()
    nodes = build_crafting_tree(output_ref, gd, session_data or {})
    _force_auto(nodes)
    use_fine = (variant == 'fine')
    gs = {'target_quality': quality, 'use_fine': use_fine, 'target_quantity': 1,
          'buffer_percentage': 0.0}
    # Decide gather-pull eligibility: need the stored gather steps (gather_reuse)
    # AND a stored gearset for EVERY gather leaf (so none renders blank).
    gather_exports = None
    if gather_reuse and db is not None and session_uuid:
        try:
            gather_exports = _gather_gearset_export_map(db, session_uuid)
            if not _all_gathers_have_stored_gearset(nodes, gather_exports, use_fine):
                gather_exports = None
        except Exception:
            gather_exports = None
    if gather_exports is not None:
        # Skip the gather gear B&B (reuse the target-items solve) + keep the m0
        # chain consistent via the pulled gather cost — exactly the grid path.
        gs['_fc_gather_reuse'] = gather_reuse
        gs['_fc_skip_pinned_gather_solve'] = True
    optimize_tree_exact('fastest-craft-save', nodes, gs, session_data or {},
                        ui_config or {}, log=log)
    # fc-preopt A: pin gather leaves to the native target-items steps so the
    # opened crafting tree shows the SAME gather numbers as the FC grid + the
    # Fastest Target Items report (not the crafting-tree's own gather formula).
    if gather_reuse:
        try:
            pin_gather_reuse(nodes, gather_reuse, use_fine=use_fine)
        except Exception:
            pass
    # GATHER-PULL display: transplant each gather's stored target-items gearset
    # onto its node (the skipped solve left it empty). Pure display wiring — the
    # pinned steps above already set the node's step cost.
    if gather_exports is not None:
        try:
            _transplant_gather_gearsets(nodes, gather_exports, use_fine)
        except Exception:
            pass
    calc = calculate_tree(nodes, gs, gd, session_data or {})
    summary = calc.get('summary') if isinstance(calc, dict) else None
    try:
        obj = _resolve_item_ref(output_ref)
        disp = getattr(obj, 'name', None)
    except Exception:
        disp = None
    disp = disp or output_ref.split('.')[-1].replace('_', ' ').title()
    label = name or f"{disp} — Fastest Craft ({quality}{'/Fine' if use_fine else ''})"
    return {'tree_data': {'nodes': nodes, 'global_settings': gs, 'summary': summary},
            'name': label, 'target_item_id': output_ref}


def _gather_gearset_export_map(db, session_uuid: str) -> Dict[tuple, str]:
    """{(group_slug, item_slug): gearset_export} for every stored Fastest
    Target Items gearset — the solved gear each gather leaf can reuse for
    display. Keyed exactly as _target_items_scope_index values so a gather
    node's ref maps straight to its stored export."""
    out: Dict[tuple, str] = {}
    try:
        res = db.get_stats_report_results_latest_per_scope(session_uuid) or {}
    except Exception:
        return out
    for row in (res.get('target_items') or []):
        grp = row.get('skill_name')      # OVERLOADED: group_slug (see worker)
        item = row.get('chest_name')     # OVERLOADED: item_slug
        exp = row.get('gearset_export')
        if grp is not None and item is not None and exp:
            out[(grp, item)] = exp
    return out


def _gather_scope_key(ref: str, use_fine: bool):
    """The target-items scope key (group_slug, item_slug) a gather leaf maps to,
    preferring the fine key in fine mode. None when the ref isn't a target item."""
    idx = _target_items_scope_index()
    if use_fine:
        fk = _target_items_fine_scope_index().get(ref)
        if fk:
            return fk
    return idx.get(ref)


def _all_gathers_have_stored_gearset(nodes, export_map, use_fine: bool) -> bool:
    """True only if EVERY gather (activity) leaf in the tree has a stored
    target-items gearset in export_map — the guard that keeps gather-pull from
    ever rendering a gather with no gear. False when there are no gathers."""
    gathers = [n for n in nodes if n.get('source_type') == 'activity' and n.get('item_id')]
    if not gathers:
        return False
    for n in gathers:
        key = _gather_scope_key(n.get('item_id'), use_fine)
        if not key or key not in export_map:
            return False
    return True


def _transplant_gather_gearsets(nodes, export_map, use_fine: bool) -> int:
    """Set each gather (activity) leaf's optimized_export to its STORED
    target-items gearset so the opened tree shows the gear the Fastest Target
    Items run picked (the skipped solve left it empty). Returns the count set."""
    done = 0
    for n in nodes:
        if n.get('source_type') != 'activity' or not n.get('item_id'):
            continue
        key = _gather_scope_key(n.get('item_id'), use_fine)
        exp = export_map.get(key) if key else None
        if exp:
            gc = n.setdefault('gear_config', {})
            gc['optimized_export'] = exp
            gc.setdefault('mode', 'auto')
            done += 1
    return done
    summary = calc.get('summary') if isinstance(calc, dict) else None
    try:
        obj = _resolve_item_ref(output_ref)
        disp = getattr(obj, 'name', None)
    except Exception:
        disp = None
    disp = disp or output_ref.split('.')[-1].replace('_', ' ').title()
    label = name or f"{disp} — Fastest Craft ({quality}{'/Fine' if use_fine else ''})"
    return {'tree_data': {'nodes': nodes, 'global_settings': gs, 'summary': summary},
            'name': label, 'target_item_id': output_ref}


def build_and_save_tree(db, session_uuid: str, output_ref: str, session_data: dict,
                        ui_config: Optional[dict] = None, *,
                        quality: str = 'Normal', variant: str = 'normal',
                        name: Optional[str] = None, log=None) -> Dict:
    """Build + optimize the crafting tree for one item at a (quality, variant)
    and persist it to saved_crafting_trees in the SAME shape the crafting-tree
    view saves/loads ({nodes, global_settings, summary}) so it opens natively
    (task 5.9). Returns {tree_id, name}."""
    built = build_fastest_craft_tree(output_ref, session_data, ui_config,
                                     quality=quality, variant=variant,
                                     name=name, log=log)
    tree_id = db.save_crafting_tree(session_uuid, built['name'], output_ref,
                                    built['tree_data'])
    return {'tree_id': tree_id, 'name': built['name']}


def group_results_for_ui(rows, name_cats=None, stale_refs=None, groups_by_ref=None,
                         owned_counts=None) -> Dict:
    """Shape stored fastest_craft_results rows into the Phase 5 UI payload.

    Groups rows by item_ref; attaches display name + pill categories
    (name_cats: ref -> (output_name, [categories])), a stale flag
    (stale_refs: set of stale item_refs), and the per-quality headline =
    min(total_steps / with_banked_steps) across the normal+fine variants. This
    is the exact object the goals-report Fastest Craft section binds to;
    keeping it pure makes the /api/fastest-craft/results contract unit-testable
    without a live request.

    owned_counts (ref -> count): when supplied, each item gets a `material_usage`
    map {variant: {materials:[{ref,name,per_craft,owned}], crafts_possible}}
    derived from the Normal-quality cell's stored material_offsets — the data the
    (i) tooltip renders (how much of each material one craft uses + how many
    crafts the current stock covers). Pure arithmetic; no solve."""
    name_cats = name_cats or {}
    stale_refs = set(stale_refs or ())
    groups_by_ref = groups_by_ref or {}
    owned_counts = owned_counts or {}
    items: Dict[str, Dict] = {}
    for r in rows:
        ref = r['item_ref']
        it = items.setdefault(ref, {'item_ref': ref, 'variants': {}})
        it['variants'].setdefault(r['variant'], {})[r['quality']] = {
            'total_steps': r.get('total_steps_per_craft'),
            'with_banked_steps': r.get('with_banked_steps'),
            'base_gearset_export': r.get('base_gearset_export'),
        }
        # Capture the Normal-quality cell's material offsets per variant for the
        # (i) tooltip's per-craft material usage (quality-inert enough for the
        # "how many of each material + how many crafts" view).
        if r.get('quality') == 'Normal':
            it.setdefault('_off', {})[r['variant']] = r.get('material_offsets') or {}
    for ref, it in items.items():
        nm, cats = name_cats.get(
            ref, (ref.split('.')[-1].replace('_', ' ').title(), []))
        it['output_name'] = nm
        it['categories'] = cats
        it['stale'] = ref in stale_refs
        # Master category key (gear/tools/cons/mat) for the grouped report
        # layout; falls back to None when not supplied (callers without the
        # enumeration map, e.g. some unit tests).
        it['group'] = groups_by_ref.get(ref)
        # Items activate the quality axis (6 qualities); materials/consumables
        # are quality-inert → the UI shows a variant dropdown, no quality one.
        it['quality_bearing'] = _is_quality_bearing(ref)
        headline: Dict[str, Dict] = {}
        for q in QUALITIES:
            tot = [v[q]['total_steps'] for v in it['variants'].values()
                   if v.get(q) and v[q].get('total_steps') is not None
                   and v[q]['total_steps'] > 0]
            bnk = [v[q]['with_banked_steps'] for v in it['variants'].values()
                   if v.get(q) and v[q].get('with_banked_steps') is not None
                   and v[q]['with_banked_steps'] > 0]
            headline[q] = {'total_steps': min(tot) if tot else None,
                           'with_banked_steps': min(bnk) if bnk else None}
        it['headline'] = headline
        # Per-variant material usage for the (i) tooltip.
        mu: Dict[str, Dict] = {}
        for variant, offs in (it.pop('_off', {}) or {}).items():
            mats = []
            crafts_possible = None
            for mref, agg in (offs or {}).items():
                try:
                    per = float((agg or {}).get('needed') or 0.0)
                except (TypeError, ValueError):
                    per = 0.0
                if per <= 0:
                    continue
                own = int(owned_counts.get(mref, 0) or 0)
                mats.append({
                    'ref': mref,
                    'name': mref.split('.')[-1].replace('_', ' ').title(),
                    'per_craft': round(per, 2),
                    'owned': own,
                })
                cp = int(own // per) if per > 0 else 0
                crafts_possible = cp if crafts_possible is None else min(crafts_possible, cp)
            if mats:
                mats.sort(key=lambda m: m['name'])
                mu[variant] = {'materials': mats,
                               'crafts_possible': crafts_possible if crafts_possible is not None else 0}
        if mu:
            it['material_usage'] = mu
    return items


# ── cross-run reuse plan (Start-time) ───────────────────────────────────────
# The browser solve runs with db=None (Pyodide) and the stale detector is NOT
# in the bundle, so fresh-vs-stale cannot be decided client-side. The server
# computes a PLAN at Start: which selected FC cells are fresh (reuse) vs todo
# (solve = stale OR missing), plus how many target-item rows are still missing,
# yielding a fixed, non-growing progress denominator. These two helpers are the
# PURE core (no DB) so they unit-test without a browser; the DB-bound inputs
# (stored rows, stale set via live_stale_items, target-items-missing count) are
# gathered by the /api/fastest-craft/plan endpoint and passed in.
def expanded_fastest_craft_refs(selected_ids: Optional[Set[str]], *,
                                max_items: Optional[int] = None,
                                expand_intermediates: bool = True) -> List[str]:
    """The ordered output_refs run_fastest_craft WOULD solve for a selection.

    Mirrors run_fastest_craft's own enumeration + auto-expand EXACTLY so the
    plan's fresh/todo partition lines up 1:1 with the solve order (crafted
    intermediates — e.g. planks — prepended, sorted, then the selected seeds in
    output_name order). Pure / catalog-only; no DB, no solve."""
    items = enumerate_craftable_items(selected_ids)
    if max_items is not None:
        items = items[:max_items]
    refs = [it['output_ref'] for it in items]
    if expand_intermediates:
        try:
            seeds = set(refs)
            extra = sorted(intermediate_crafted_refs(seeds) - seeds)
            refs = extra + refs
        except Exception:  # noqa: BLE001 — auto-expand is best-effort (matches run_)
            pass
    seen: Set[str] = set()
    ordered: List[str] = []
    for r in refs:
        if r and r not in seen:
            seen.add(r)
            ordered.append(r)
    return ordered


def plan_fastest_craft(expanded_refs, *, stored_refs, stale_refs,
                       target_items_missing: int = 0) -> Dict:
    """Partition the FC output refs that WOULD be solved into FRESH (reuse the
    stored fastest_craft_results row) vs TODO (solve), and compute the stable,
    non-growing progress denominator.

    An output is TODO when it is MISSING (no stored row) OR STALE; otherwise it
    is FRESH and reused for display. Order is preserved so crafted deps still
    precede their parents in the solve list.

    expanded_refs: ordered refs from expanded_fastest_craft_refs(...).
    stored_refs:   refs that have a stored row (present in fastest_craft_results).
    stale_refs:    refs whose stored row is STALE — from live_stale_items(...).
                   Per the product rule, staleness drives redo for FC CELLS ONLY;
                   target items are reused on presence alone (never stale-redone),
                   so their count arrives here already presence-subtracted.
    target_items_missing: count of target-item jobs still to generate
                   (presence-based, cross-run) — supplied by the caller.

    Returns {todo_refs, fresh_refs, fc_todo_cells, target_items_missing,
    denominator}. denominator = fc_todo_cells + target_items_missing — known at
    Start, only shrinks as work lands, never grows."""
    stored = set(stored_refs or ())
    stale = set(stale_refs or ())
    todo: List[str] = []
    fresh: List[str] = []
    for ref in (expanded_refs or []):
        if (ref not in stored) or (ref in stale):
            todo.append(ref)
        else:
            fresh.append(ref)
    fc_todo_cells = sum(_visible_cell_count(r) for r in todo)
    ti_missing = max(0, int(target_items_missing or 0))
    return {
        'todo_refs': todo,
        'fresh_refs': fresh,
        'fc_todo_cells': fc_todo_cells,
        'target_items_missing': ti_missing,
        'denominator': fc_todo_cells + ti_missing,
    }


_TI_NAME_INDEX: Optional[tuple] = None


def _target_items_name_index() -> tuple:
    """(name -> (group,item) base, name -> (group,item) fine) over every
    activity-droppable material, keyed by the material's DISPLAY NAME (what a
    recipe input MaterialInstance exposes). Mirrors _target_items_scope_index
    but name-keyed, so the all-routes recipe walk — which sees input names, not
    refs — can map a gathered input to its target_items scope. Cached."""
    global _TI_NAME_INDEX
    if _TI_NAME_INDEX is not None:
        return _TI_NAME_INDEX
    base: Dict[str, tuple] = {}
    fine: Dict[str, tuple] = {}
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
        from util.stats_report.target_items import classify_drop_entry_all
    except Exception:
        _TI_NAME_INDEX = ({}, {})
        return _TI_NAME_INDEX
    for activity in ACTIVITIES_BY_NAME.values():
        drops = list(getattr(activity, 'drop_table', None) or []) + \
                list(getattr(activity, 'secondary_drop_table', None) or [])
        for d in drops:
            try:
                for (group_slug, item_slug, name, _ref, is_fine) in \
                        classify_drop_entry_all(d, include_fine=True):
                    if not name:
                        continue
                    (fine if is_fine else base).setdefault(
                        name, (group_slug, item_slug))
            except Exception:
                continue
    _TI_NAME_INDEX = (base, fine)
    return _TI_NAME_INDEX


def _reset_ti_name_index():
    """Test hook: drop the cached name index."""
    global _TI_NAME_INDEX
    _TI_NAME_INDEX = None


def all_route_gather_keys(output_refs, recipes_by_name=None) -> Set[str]:
    """Canonical target_items scope keys for EVERY activity-droppable material
    reachable through ANY recipe route of the given craftable outputs.

    Walks all recipes producing each output (not just the default route
    build_crafting_tree picks), descending through crafted inputs, and emits the
    'target_items::<group>::<item>::NONE::NONE' key (base AND fine) for each
    gathered input. This is the pre-countable, solver-independent superset the
    exact driver trials — the set target-items generation should cover so the
    Start-time denominator equals what actually gets generated. Catalog-only
    (accessibility is applied later by build_target_items_jobs); pure + cached
    indices make it unit-testable without a browser."""
    if recipes_by_name is None:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.recipes import RECIPES_BY_NAME as recipes_by_name
    # All recipes per output (ALL routes — first-wins indexing would drop
    # alternate-route recipes like plank-from-scrap).
    recipes_for_output: Dict[str, list] = {}
    for recipe in recipes_by_name.values():
        oref = getattr(recipe, 'output_item', None)
        if oref:
            recipes_for_output.setdefault(oref, []).append(recipe)
    name_to_ref = _craftable_name_to_ref(recipes_by_name)
    base_names, fine_names = _target_items_name_index()
    keys: Set[str] = set()
    visited: Set[str] = set()

    def _visit(ref: str):
        if not ref or ref in visited:
            return
        visited.add(ref)
        for recipe in recipes_for_output.get(ref, ()):  # every route
            for group in (getattr(recipe, 'materials', None) or []):
                for entry in (group or []):
                    mi = entry[1] if isinstance(entry, (tuple, list)) and len(entry) >= 2 else entry
                    nm = getattr(mi, 'name', None)
                    if not nm:
                        continue
                    hit = base_names.get(nm)
                    if hit:
                        keys.add(canonical_scope_key('target_items', hit[0], hit[1], 'NONE', 'NONE'))
                    fhit = fine_names.get(nm)
                    if fhit:
                        keys.add(canonical_scope_key('target_items', fhit[0], fhit[1], 'NONE', 'NONE'))
                    cref = name_to_ref.get(nm)   # crafted input -> recurse its routes
                    if cref:
                        _visit(cref)

    for r in (output_refs or ()):
        _visit(r)
    return keys


def target_items_missing_count(candidate_keys, present_pairs, job_pairs) -> int:
    """Pure count of target-item JOBS still to generate for the plan denominator.

    candidate_keys: canonical 'target_items::group::item::NONE::NONE' strings
      (from all_route_gather_keys) — the materials in scope for the selection.
    present_pairs: iterable of (group_lower, item_slug) already stored for the
      SESSION (cross-run presence; reuse-on-presence, never stale-redone).
    job_pairs: iterable of (group_lower, item_slug) — ONE entry per concrete
      target_items job the generator would build (per activity, base+fine), from
      build_target_items_jobs. Counting these (restricted to candidate & missing)
      yields the exact per-source number the user expects ('bamboo logs ×2,
      wood scrap ×7, +fine').

    missing (group,item) = candidate - present; the result counts job_pairs whose
    (group,item) is missing — so bar == what generation actually writes."""
    candidate = set()
    for k in (candidate_keys or ()):
        parts = str(k).split('::')
        if len(parts) >= 3 and parts[0] == 'target_items' and parts[1] and parts[2]:
            candidate.add((parts[1].lower(), parts[2]))
    present = {((g or '').lower(), i) for (g, i) in (present_pairs or ())}
    missing = candidate - present
    return sum(1 for (g, i) in (job_pairs or ())
               if ((g or '').lower(), i) in missing)


def run_fastest_craft(session_uuid: str, selected_ids: Optional[Set[str]],
                      session_data: dict, ui_config: Optional[dict] = None,
                      *, max_items: Optional[int] = None, progress=None,
                      with_details: bool = False, db=None,
                      owned_counts: Optional[dict] = None, log=None,
                      expand_intermediates: bool = True,
                      item_sink=None, only_refs: Optional[Set[str]] = None,
                      fast: bool = False,
                      shard_index: Optional[int] = None,
                      shard_count: Optional[int] = None,
                      gather_reuse: Optional[dict] = None) -> Dict:
    """Orchestrator (Phases 2.1/2.2 + 3 persistence): enumerate the in-scope
    craftable items and solve each across variants × qualities.

    selected_ids: prefixed chip ids (see enumerate_craftable_items); None or
    empty = every craftable output.

    progress(done, total): optional UI progress callback (Phase 2.2). A per-run
    memo dedups identical output refs. When `db` is provided, each item's results
    are persisted to `fastest_craft_results` with the banked step count computed
    from `owned_counts` (Phase 3). `with_details` (implied by db) includes the
    per-(variant, quality) detail breakdown in the return.

    Returns {'items': [{...variants, headline[, details]}], 'count': N}.
    """
    if log is None:
        def log(*_a, **_k):
            pass
    # fc-preopt A: thread the native target-items gather-steps map onto a COPY
    # of ui_config so _fc_settings carries it onto every cell's gs and
    # _record_cell pins gather leaves to the target-items number. A copy avoids
    # mutating the caller's/session ui_config. None => no pinning.
    if gather_reuse:
        ui_config = {**(ui_config or {}), '_fc_gather_reuse': gather_reuse,
                     '_fc_skip_pinned_gather_solve': True}
    want_details = with_details or (db is not None)
    items = enumerate_craftable_items(selected_ids)
    if max_items is not None:
        items = items[:max_items]
    # Auto-expand (user 2026-10-09): a selected craftable also surfaces its
    # intermediate CRAFTED inputs (e.g. a toolbox's planks) as their own output
    # rows. Applied AFTER max_items so the cap limits SELECTED seeds; a seed's
    # crafted inputs are always included. Dependencies are placed FIRST so a
    # parent solve can reuse an already-solved child; dedup is handled by `memo`.
    if expand_intermediates:
        try:
            seed_refs = {it['output_ref'] for it in items}
            extra_refs = intermediate_crafted_refs(seed_refs) - seed_refs
            if extra_refs:
                by_ref = {it['output_ref']: it
                          for it in enumerate_craftable_items(None)}
                extra_items = [by_ref[r] for r in sorted(extra_refs) if r in by_ref]
                items = extra_items + items
        except Exception as e:  # noqa: BLE001 — auto-expand is best-effort
            log(f"[fastest-craft] auto-expand failed: {e!r}")
    # Cross-run reuse (Phase 6): the /plan endpoint decided which cells are FRESH
    # (reused from storage) vs TODO (STALE or MISSING). When the caller passes
    # only_refs, solve ONLY those — the fresh cells are rendered from their
    # stored rows by the browser, never re-solved. Applied AFTER auto-expand so a
    # fresh plank is dropped from the solve set (its parent still computes it
    # inside its own tree when needed). total then counts only the TODO cells.
    if only_refs is not None:
        _todo = set(only_refs)
        items = [it for it in items if it.get('output_ref') in _todo]
    # Parallel sharding (fc-preopt Step 5): when the browser fans FC across N
    # web workers, each worker runs this with (shard_index, shard_count) and
    # keeps only its round-robin slice of the (deterministically ordered) item
    # list. Each item's whole tree is solved independently, so the union of
    # shards is identical to a single serial run — just split across cores.
    if shard_count and shard_count > 1 and shard_index is not None:
        items = [it for i, it in enumerate(items) if i % shard_count == int(shard_index)]
    # Progress denominator = Σ VISIBLE cells per item (quality-bearing Item = 11:
    # 6 normal + 5 fine; material/consumable = 2: one Normal solve per variant).
    # e.g. 2 toolboxes + their 2 planks = 2×11 + 2×2 = 26.
    total = sum(_visible_cell_count(it['output_ref']) for it in items)
    done = [0]

    def _emit():
        if progress:
            try:
                progress(done[0], total)
            except Exception:
                pass
    _emit()
    results = []
    memo: Dict[str, Dict] = {}  # output_ref -> solved (dedup within a run)
    reuse_memo: Dict[tuple, dict] = {}  # (ref, variant) -> {cum, gear} cross-item reuse
    # Run-scoped gather-leaf solve cache: a gather activity (e.g. "Cut pine
    # trees", "Firewood making") is solved ONCE per run and reused across every
    # item/variant/route-trial that gathers the same material, instead of
    # re-running its [MITM-ONLY] branch-and-bound each time (bug 3f845fc3: pine
    # solved 6x, firewood 2x for a 4-item run). Pure cache — results are
    # byte-identical to a fresh solve, proven by the oracle-equivalence tests.
    leaf_memo: Dict[tuple, object] = {}
    for idx, it in enumerate(items, 1):
        ref = it['output_ref']
        solved = memo.get(ref)
        # Snapshot the gather-leaf memo so we can attribute THIS item's gathers
        # (incl. its losing route-trial candidates + fine variants) for an
        # incremental per-item persist (item_sink). A cross-item cache hit adds
        # no new leaf_memo entry, so the earlier item that solved it owns it.
        _lm_before = (set(leaf_memo) if (item_sink is not None and leaf_memo is not None)
                      else None)
        if solved is None:
            def _tick():
                done[0] += 1
                _emit()
            solved = solve_item_all_qualities(ref, session_data, ui_config,
                                              log=log, with_details=want_details,
                                              solve_progress=_tick,
                                              child_memo=reuse_memo,
                                              capture_reuse=True,
                                              leaf_memo=leaf_memo, fast=fast)
            memo[ref] = solved
            # Feed this item's solved subtree into the reuse memo so a later
            # PARENT that consumes it (deps are enumerated first) reuses it
            # instead of re-running its branch-and-bound.
            for _v, _r in (solved.get('reuse') or {}).items():
                reuse_memo[(ref, _v)] = _r
            if db is not None and solved.get('details'):
                try:
                    oc = owned_counts
                    if oc is None:
                        oc = owned_counts_for_refs(
                            _refs_in_details(solved['details']), session_data)
                    # Base-node dominance capture (Phase 4 gap): one bitmap per
                    # item (quality/variant-invariant crafting-gear pool) with
                    # its exact scope stored for a stable recompute.
                    _bscope = _base_scope_for_recipe(it.get('recipe_name'), session_data)
                    _bbm = None
                    if _bscope is not None:
                        try:
                            from util.stats_report.state_snapshot import from_char_config
                            _bsnap = from_char_config(session_data or {}, ui_config or {})
                            _bbm = base_dominance_bitmap(_bsnap, _bscope, db)
                        except Exception:
                            _bbm = None
                    persist_fastest_craft(db, session_uuid, ref,
                                          solved['details'], oc,
                                          base_scope=_bscope, base_bitmap=_bbm,
                                          session_data=session_data)
                except Exception as e:  # noqa: BLE001 — persistence is best-effort
                    log(f"[fastest-craft] persist failed {ref}: {e!r}")
        else:
            # Deduped (identical ref already solved this run): count its visible
            # cells as done so the per-solve bar stays accurate.
            done[0] += _visible_cell_count(ref)
            _emit()
        results.append({**it, **{k: v for k, v in solved.items() if k != 'reuse'}})
        # Incremental per-item persist (local path): hand this item + the fine-
        # aware gather keys it evaluated to the sink NOW, so a cancel keeps the
        # finished items and their Fastest Target Items rows (best-effort).
        if item_sink is not None:
            try:
                _entry = results[-1]
                _delta = {}
                if _lm_before is not None and leaf_memo is not None:
                    _delta = {k: leaf_memo[k] for k in (set(leaf_memo) - _lm_before)}
                _ikeys = sorted(gather_scope_keys_from_leaf_memo(
                    _delta, _target_items_scope_index(),
                    _target_items_fine_scope_index()))
                item_sink({'item': {k: v for k, v in _entry.items() if k != 'reuse'},
                           'gather_scope_keys': _ikeys})
            except Exception as e:  # noqa: BLE001 — never fail the run on sink
                log(f"[fastest-craft] item_sink failed {ref}: {e!r}")
    _emit()
    # Every gather leaf the run SOLVED is recorded in leaf_memo — including the
    # losing route-trial candidates the optimizer evaluated and rejected (e.g.
    # the wood-scrap plank route that lost to logs). Map each to its canonical
    # target_items scope key so the caller can generate a Fastest Target Items
    # row for ALL evaluated materials, not just the ones in the chosen trees.
    gather_keys = set()
    try:
        gather_keys = gather_scope_keys_from_leaf_memo(
            leaf_memo, _target_items_scope_index(), _target_items_fine_scope_index())
    except Exception as e:  # noqa: BLE001 — best-effort, never fail the run
        log(f"[fastest-craft] gather_scope_keys collection failed: {e!r}")
    return {'items': results, 'count': len(results),
            'gather_scope_keys': sorted(gather_keys)}


# ── Phase 4: stale-detection subscription (R7) ──────────────────────────────
def item_base_scope_key(item_ref: str) -> str:
    """Scope key for a Fastest Craft row's BASE (final-craft) node — distinct
    from the reused goals-report sub-result scope keys so the base solve can go
    stale independently of its subtree."""
    return f"fastest_craft::{item_ref}"


def row_scope_keys(row: Dict) -> list:
    """Every scope key a stored row depends on: its reused subtree scope keys
    (goals-report target/chest/chests_recipes scopes) plus its own base-node
    scope key. The row is stale iff ANY of these is stale."""
    keys = list(row.get('subtree_scope_keys') or [])
    keys.append(item_base_scope_key(row.get('item_ref')))
    return keys


def fastest_craft_stale_items(rows, is_scope_stale) -> Set[str]:
    """Return the set of item_refs whose Fastest Craft result is stale.

    `is_scope_stale(scope_key) -> bool` is supplied by the caller and backed by
    the existing goals-report scope-keyed stale detector
    (util/stats_report/stale_detector). Staleness is a pure OR over each row's
    scope keys (R7-A gear/item domination inherited transitively through the
    reused sub-result scopes; R7-B service changes inherited through the
    chests_recipes scope keys — both already modeled by the detector, so no new
    service logic is needed here). Decoupling via the predicate keeps this unit
    testable without the detector and lets the integration point map stored keys
    to the detector's live (category, subcategory, source, location, service)
    scopes.
    """
    stale: Set[str] = set()
    for row in rows or []:
        ref = row.get('item_ref')
        if ref in stale:
            continue
        for k in row_scope_keys(row):
            try:
                if is_scope_stale(k):
                    stale.add(ref)
                    break
            except Exception:
                continue
    return stale


# ── Phase 4 (cont.): live-detector adapter ──────────────────────────────────
def canonical_scope_key(category, subcategory, source_name, location, service) -> str:
    """Canonical string form of a goals-report scope tuple
    (category, subcategory, source_name, location, service). This is the SINGLE
    format shared by (a) the stored leaf subtree_scope_keys and (b) the set
    derived from the live stale detector, so fastest_craft_stale_items can OR
    them directly."""
    return "::".join('' if x is None else str(x)
                     for x in (category, subcategory, source_name, location, service))


def detector_stale_scope_keys(stale_scopes) -> Set[str]:
    """Convert util.stats_report.stale_detector.detect_stale_scopes() output
    (an iterable of StaleScope dataclasses) into the canonical scope-key set."""
    out: Set[str] = set()
    for ss in stale_scopes or []:
        out.add(canonical_scope_key(
            getattr(ss, 'category', ''), getattr(ss, 'subcategory', ''),
            getattr(ss, 'source_name', ''), getattr(ss, 'location', ''),
            getattr(ss, 'service', '')))
    return out


def stale_predicate_from_keys(stale_key_set):
    """Build the is_scope_stale(scope_key)->bool predicate consumed by
    fastest_craft_stale_items from a set of canonical stale scope keys (e.g.
    detector_stale_scope_keys(detect_stale_scopes(...)))."""
    s = set(stale_key_set or ())
    return lambda k: k in s


def live_stale_items(db, session_uuid, curr_snapshot, *, char_config=None,
                     item_refs=None, prev_snapshot=None):
    """End-to-end Phase 4 integration: compute which stored Fastest Craft items
    are stale by running the live goals-report stale detector against the
    current character snapshot and OR-ing the resulting stale scope keys over
    each row's scope keys.

    `curr_snapshot` is a util.stats_report.state_snapshot.CharacterStateSnapshot;
    `prev_snapshot` may be None (the detector's per-row + version-bump +
    newly-unlocked checks run regardless of prev, per its docstring). Returns a
    set of stale item_refs. Best-effort: any detector failure yields an empty
    stale set (nothing flagged) rather than raising."""
    try:
        from util.stats_report.stale_detector import detect_stale_scopes
        scopes = detect_stale_scopes(prev_snapshot, curr_snapshot, db,
                                     session_uuid=session_uuid, char_config=char_config)
        key_set = detector_stale_scope_keys(scopes)
    except Exception:
        return set()
    rows = db.get_fastest_craft_results(session_uuid, item_refs)
    stale = fastest_craft_stale_items(rows, stale_predicate_from_keys(key_set))
    # Self-healing migration: flag any row whose stored from-scratch total is
    # CORRUPT so the next run re-solves it. A real one-craft tree costs
    # total_steps >= root_self_steps (root's own steps + its children's); a
    # stored total that is missing, <= 0, or below root_self is a degenerate
    # calc — e.g. rows written before use_owned_quantities was forced OFF in
    # _fc_settings, where summary.total_steps was owned-reduced (and fully-owned
    # chains collapsed to 0 -> stored None). Pure arithmetic over rows already
    # fetched; no re-solve here, just the redo signal.
    for row in rows:
        ref = row.get('item_ref')
        if ref in stale:
            continue
        tot = row.get('total_steps_per_craft')
        rself = row.get('root_self_steps')
        try:
            tot_f = float(tot) if tot is not None else None
        except (TypeError, ValueError):
            tot_f = None
        try:
            rself_f = float(rself) if rself is not None else None
        except (TypeError, ValueError):
            rself_f = None
        if tot_f is None or tot_f <= 0 or (
                rself_f is not None and rself_f > 0 and tot_f < rself_f - 1e-6):
            stale.add(ref)
    # Base-node dominance recompute (Phase 4 gap): a base/final-craft gear change
    # moves no gather-leaf target_items scope, so recompute each row's stored
    # base scope bitmap under the CURRENT snapshot and compare to the stored one.
    # Scope is reused verbatim, so only gear changes the bitmap. Best-effort.
    for row in rows:
        ref = row.get('item_ref')
        if ref in stale:
            continue
        scope = row.get('base_scope')
        stored_bm = row.get('base_dominance_bitmap')
        if not scope or stored_bm is None:
            continue
        try:
            cur_bm = base_dominance_bitmap(curr_snapshot, scope, db)
        except Exception:
            cur_bm = None
        if cur_bm is not None and cur_bm != stored_bm:
            stale.add(ref)
    return stale
