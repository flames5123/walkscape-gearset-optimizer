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


def _target_items_scope_index() -> Dict[str, tuple]:
    """ref -> (group_slug, item_slug) for every activity-droppable, classifiable
    material — the SAME universe enumerate_applicable_sources emits target_items
    scopes for. Cached. The base (non-fine) slug is kept (classify_drop_entry_all
    yields base before fine, so setdefault registers base first)."""
    global _TI_SCOPE_INDEX
    if _TI_SCOPE_INDEX is not None:
        return _TI_SCOPE_INDEX
    idx: Dict[str, tuple] = {}
    try:
        import util.walkscape_constants  # noqa: F401  (init order)
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
        from util.stats_report.target_items import classify_drop_entry_all
    except Exception:
        _TI_SCOPE_INDEX = {}
        return _TI_SCOPE_INDEX
    for activity in ACTIVITIES_BY_NAME.values():
        drops = list(getattr(activity, 'drop_table', None) or []) + \
                list(getattr(activity, 'secondary_drop_table', None) or [])
        for d in drops:
            try:
                for (group_slug, item_slug, _name, ref, _is_fine) in \
                        classify_drop_entry_all(d, include_fine=True):
                    if ref:
                        idx.setdefault(ref, (group_slug, item_slug))
            except Exception:
                continue
    _TI_SCOPE_INDEX = idx
    return idx


def _reset_ti_scope_index():
    """Test hook: drop the cached target_items scope index."""
    global _TI_SCOPE_INDEX
    _TI_SCOPE_INDEX = None


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


def _fc_settings(quality: str, use_fine: bool) -> dict:
    """Solve settings for one (variant, quality) cell. Buffer 0 / qty 1 makes
    summary.total_steps the clean per-one total."""
    return {'target_quality': quality, 'use_fine': use_fine,
            'skip_shops': True, 'skip_chests': True,
            'optimize_pets': False, 'optimize_consumables': False,
            'target_quantity': 1, 'buffer_percentage': 0.0}


def _record_cell(nodes, gs, gd, session_data, with_details):
    """calculate_tree a solved tree and return (total_steps|None, detail|None)."""
    from ui.crafting_tree import calculate_tree
    calc = calculate_tree(nodes, gs, gd, session_data)
    total = (calc.get('summary') or {}).get('total_steps')
    try:
        total = float(total) if total not in (None, float('inf')) else None
    except (TypeError, ValueError):
        total = None
    detail = None
    if with_details:
        root_self, offsets, root_export, child_q = _tree_breakdown(nodes)
        detail = {
            'total_steps': total, 'root_self': root_self,
            'offsets': offsets, 'base_gearset_export': root_export,
            'child_quantities': child_q,
            'subtree_scope_keys': subtree_scope_keys_for_tree(nodes),
        }
    return total, detail


def _solve_cell_full(output_ref, variant, quality, session_data, ui_config,
                     gd, log, with_details, compute_alternatives=True):
    """Build + fully exact-solve one (variant, quality) cell from scratch."""
    from ui.crafting_tree import build_crafting_tree
    from ui.crafting_tree_exact_driver import optimize_tree_exact
    nodes = build_crafting_tree(output_ref, gd, session_data)
    _force_auto(nodes)
    gs = _fc_settings(quality, variant == 'fine')
    optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                        ui_config or {}, log=log,
                        compute_alternatives=compute_alternatives)
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
                             capture_reuse=False) -> Dict:
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
                                    compute_alternatives=False)
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
            gs = _fc_settings(base_quality, use_fine)
            diag = optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                                       ui_config or {}, log=log, return_cum=True,
                                       compute_alternatives=False,
                                       scope_ids=scope_ids, cum_seed=cum_seed)
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
                gs = _fc_settings(base_quality, use_fine)
                diag = optimize_tree_exact('fastest-craft', nodes, gs, session_data,
                                           ui_config or {}, log=log, return_cum=True,
                                           compute_alternatives=False)
                cum = diag.get('cum') if reusable else None
                cell = _record_cell(nodes, gs, gd, session_data, with_details)
            except Exception as e:  # noqa: BLE001
                log(f"[fastest-craft] solve failed {output_ref} {variant}/{base_quality}: {e!r}")
                cell = (None, None)
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
                    gs = _fc_settings(quality, use_fine)
                    if optimize_root_only('fastest-craft', nodes, gs, session_data,
                                          ui_config or {}, cum, log=log,
                                          compute_alternatives=False) is not None:
                        cell = _record_cell(nodes, gs, gd, session_data, with_details)
                except Exception as e:  # noqa: BLE001
                    log(f"[fastest-craft] root re-solve failed {output_ref} "
                        f"{variant}/{quality}, full solve instead: {e!r}")
                    cell = None
            if cell is None:
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
                          *, base_scope=None, base_bitmap=None):
    """Write every (variant, quality) detail row for one item, computing the
    banked step count from the owned counts. Returns the number of rows written."""
    owned_counts = owned_counts or {}
    written = 0
    for variant, qmap in (details or {}).items():
        for quality, d in (qmap or {}).items():
            if not d:
                continue
            offsets = d.get('offsets') or {}
            banked = compute_with_banked(d.get('total_steps'), d.get('root_self'),
                                         offsets, owned_counts)
            needed_owned = {ref: owned_counts.get(ref, 0) for ref in offsets}
            db.upsert_fastest_craft_result(
                session_uuid, item_ref, variant, quality,
                base_gearset_export=d.get('base_gearset_export'),
                total_steps=d.get('total_steps'), with_banked_steps=banked,
                root_self_steps=d.get('root_self'),
                child_quantities=d.get('child_quantities'),
                material_offsets=offsets, needed_owned_counts=needed_owned,
                subtree_scope_keys=d.get('subtree_scope_keys'),
                base_dominance_bitmap=base_bitmap, base_scope=base_scope)
            written += 1
    return written


def refresh_banked_if_stale(db, session_uuid, owned_counts, item_refs=None):
    """Page-load recompute (R6): for each stored row whose owned-count snapshot
    (restricted to that item's materials) no longer matches the current owned
    counts, recompute the banked step count from the STORED material offsets
    (pure arithmetic, no re-solve) and update it. Returns the number of rows
    updated. Rows whose relevant owned counts are unchanged are left untouched."""
    owned_counts = owned_counts or {}
    rows = db.get_fastest_craft_results(session_uuid, item_refs)
    updated = 0
    for row in rows:
        offsets = row.get('material_offsets') or {}
        stored = row.get('needed_owned_counts') or {}
        cur = {ref: owned_counts.get(ref, 0) for ref in offsets}
        if _owned_equal(cur, stored):
            continue
        banked = compute_with_banked(row.get('total_steps_per_craft'),
                                     row.get('root_self_steps'), offsets, owned_counts)
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
          'buffer_percentage': 0.0}
    optimize_tree_exact('fastest-craft-preview', nodes, gs, session_data or {},
                        ui_config or {}, log=log)
    calculate_tree(nodes, gs, gd, session_data or {})
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


def build_and_save_tree(db, session_uuid: str, output_ref: str, session_data: dict,
                        ui_config: Optional[dict] = None, *,
                        quality: str = 'Normal', variant: str = 'normal',
                        name: Optional[str] = None, log=None) -> Dict:
    """Build + optimize the crafting tree for one item at a (quality, variant)
    and persist it to saved_crafting_trees in the SAME shape the crafting-tree
    view saves/loads ({nodes, global_settings, summary}) so it opens natively
    (task 5.9). Returns {tree_id, name}."""
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
    optimize_tree_exact('fastest-craft-save', nodes, gs, session_data or {},
                        ui_config or {}, log=log)
    calc = calculate_tree(nodes, gs, gd, session_data or {})
    summary = calc.get('summary') if isinstance(calc, dict) else None
    try:
        obj = _resolve_item_ref(output_ref)
        disp = getattr(obj, 'name', None)
    except Exception:
        disp = None
    disp = disp or output_ref.split('.')[-1].replace('_', ' ').title()
    label = name or f"{disp} — Fastest Craft ({quality}{'/Fine' if use_fine else ''})"
    tree_data = {'nodes': nodes, 'global_settings': gs, 'summary': summary}
    tree_id = db.save_crafting_tree(session_uuid, label, output_ref, tree_data)
    return {'tree_id': tree_id, 'name': label}


def group_results_for_ui(rows, name_cats=None, stale_refs=None, groups_by_ref=None) -> Dict:
    """Shape stored fastest_craft_results rows into the Phase 5 UI payload.

    Groups rows by item_ref; attaches display name + pill categories
    (name_cats: ref -> (output_name, [categories])), a stale flag
    (stale_refs: set of stale item_refs), and the per-quality headline =
    min(total_steps / with_banked_steps) across the normal+fine variants. This
    is the exact object the goals-report Fastest Craft section binds to;
    keeping it pure makes the /api/fastest-craft/results contract unit-testable
    without a live request."""
    name_cats = name_cats or {}
    stale_refs = set(stale_refs or ())
    groups_by_ref = groups_by_ref or {}
    items: Dict[str, Dict] = {}
    for r in rows:
        ref = r['item_ref']
        it = items.setdefault(ref, {'item_ref': ref, 'variants': {}})
        it['variants'].setdefault(r['variant'], {})[r['quality']] = {
            'total_steps': r.get('total_steps_per_craft'),
            'with_banked_steps': r.get('with_banked_steps'),
            'base_gearset_export': r.get('base_gearset_export'),
        }
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
                   if v.get(q) and v[q].get('total_steps') is not None]
            bnk = [v[q]['with_banked_steps'] for v in it['variants'].values()
                   if v.get(q) and v[q].get('with_banked_steps') is not None]
            headline[q] = {'total_steps': min(tot) if tot else None,
                           'with_banked_steps': min(bnk) if bnk else None}
        it['headline'] = headline
    return items


def run_fastest_craft(session_uuid: str, selected_ids: Optional[Set[str]],
                      session_data: dict, ui_config: Optional[dict] = None,
                      *, max_items: Optional[int] = None, progress=None,
                      with_details: bool = False, db=None,
                      owned_counts: Optional[dict] = None, log=None,
                      expand_intermediates: bool = True) -> Dict:
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
    for idx, it in enumerate(items, 1):
        ref = it['output_ref']
        solved = memo.get(ref)
        if solved is None:
            def _tick():
                done[0] += 1
                _emit()
            solved = solve_item_all_qualities(ref, session_data, ui_config,
                                              log=log, with_details=want_details,
                                              solve_progress=_tick,
                                              child_memo=reuse_memo,
                                              capture_reuse=True)
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
                                          base_scope=_bscope, base_bitmap=_bbm)
                except Exception as e:  # noqa: BLE001 — persistence is best-effort
                    log(f"[fastest-craft] persist failed {ref}: {e!r}")
        else:
            # Deduped (identical ref already solved this run): count its visible
            # cells as done so the per-solve bar stays accurate.
            done[0] += _visible_cell_count(ref)
            _emit()
        results.append({**it, **{k: v for k, v in solved.items() if k != 'reuse'}})
    _emit()
    return {'items': results, 'count': len(results)}


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
