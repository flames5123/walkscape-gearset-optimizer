#!/usr/bin/env python3
"""
Walkdle puzzle catalog builder.

Builds the "guessable item" pool for the Walkdle "Guess the Item" daily-puzzle
mode (a Wordle/Squirdle-style game over WalkScape equipment).

The browser engine (ui/static/js/walkdle-engine.js) picks a deterministic daily
target from this pool (seeded by the UTC date, indexing into the pool sorted by
stable item id) and compares guesses attribute-by-attribute.

Why server-side: the per-item SOURCE set (buy / craft / activity drop / chest
drop) is derived from ItemCatalog's precomputed source-name sets, which only
exist on the Python side. We attach it here so the engine stays a pure,
data-driven comparison with no game-data knowledge.

SOURCE is MULTI-VALUED: an item can be e.g. both an activity drop and buyable,
or crafted and an activity drop. The hint engine treats the source set as
green (exact set match), yellow (non-empty intersection), or absent.
"""

from typing import Dict, List, Optional

# Walkdle launch date (day 1, UTC). Items present at launch are backfilled to
# this date so they are all "available from day 1"; later additions record the
# date first observed. Keep in sync with WALKDLE_START_DATE in walkdle-engine.js.
WALKDLE_LAUNCH_DATE = '2026-06-15'

# Canonical rarity ordering (matches ItemCatalog._sort_items). The engine uses
# the index for the rarity up/down (ordinal) hint.
RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal']

# Crafted-item quality ordering (Normal..Eternal). Crafted items are emitted
# once per quality so the player can guess a specific quality; the engine uses
# the index for the ordinal "quality" hint.
QUALITY_ORDER = ['normal', 'good', 'great', 'excellent', 'perfect', 'eternal']

_CACHE: Optional[List[Dict]] = None


def _requirement_summary(requirements):
    """Return (level_req:int, level_display:str) for the Level hint column.

    - skill / character_level requirements -> numeric level (e.g. 45 -> "45").
    - category_level_percent (e.g. Rootweave) -> percent of a skill category,
      shown as "40% gathering" (previously rendered as level 0).
    - otherwise -> (0, "—").
    The numeric level_req drives the ordinal up/down hint; level-based items use
    their level, percent-based items use the percent value.
    """
    if not requirements:
        return 0, '—'
    best_level = 0
    best_percent = None  # (percent, category)
    for req in requirements:
        if not isinstance(req, dict):
            continue
        t = req.get('type')
        if t in ('skill', 'character_level'):
            lvl = req.get('level')
            if isinstance(lvl, (int, float)) and lvl > best_level:
                best_level = int(lvl)
        elif t == 'category_level_percent':
            p = req.get('percent')
            if isinstance(p, (int, float)) and (best_percent is None or p > best_percent[0]):
                best_percent = (int(p), str(req.get('category') or '').lower())
    if best_level > 0:
        return best_level, str(best_level)
    if best_percent is not None:
        return best_percent[0], f"{best_percent[0]}% {best_percent[1]}".strip()
    return 0, '—'


def _flatten_stats(stats) -> (set, set):
    """Return (skills, stat_names) from a {skill: {location: {stat: val}}} dict.

    A specific skill (e.g. 'fishing') is collected as-is. The 'global'
    pseudo-skill ("applies to all") is normally shadowed by any specific skill,
    but if an item has ONLY global-scoped stats we surface the explicit token
    'global' so the Walkdle Skills column shows "global" (searchable as its own
    category) instead of an empty "—". Items with no stats at all stay empty.

    The distinct innermost stat names give the stat-count ordinal hint and the
    "shares a stat" categorical hint.
    """
    skills = set()
    stat_names = set()
    has_global = False
    if not isinstance(stats, dict):
        return skills, stat_names
    for skill, by_loc in stats.items():
        if skill == 'global':
            has_global = True
        elif skill:
            skills.add(str(skill).lower())
        if not isinstance(by_loc, dict):
            continue
        for _loc, by_stat in by_loc.items():
            if isinstance(by_stat, dict):
                for stat_name in by_stat.keys():
                    stat_names.add(str(stat_name))
    # Global-only items: expose 'global' as an explicit, matchable skill token.
    if not skills and has_global:
        skills.add('global')
    return skills, stat_names


def _derive_sources(item: Dict, activity_names, chest_names, shop_names,
                    achievement_names=frozenset(), ap_names=frozenset(),
                    faction_names=frozenset()) -> List[str]:
    """Multi-valued source set for an item: crafted/buy/activity/chest/reward."""
    name = item.get('name')
    sources = []
    if item.get('type') == 'crafted_item':
        sources.append('crafted')
    if name in shop_names:
        sources.append('buy')
    if name in activity_names:
        sources.append('activity')
    if name in chest_names:
        sources.append('chest')
    # Reward sources: achievement-keyword items and Achievement-Point track
    # rewards are "achievement reward"; faction-track rewards are "faction
    # reward". Without these, reward-only items showed an empty "—" source.
    if name in achievement_names or name in ap_names:
        sources.append('achievement reward')
    if name in faction_names:
        sources.append('faction reward')
    return sorted(set(sources))


def build_walkdle_items() -> List[Dict]:
    """Build the guessable item pool (cached; catalog is static).

    Pool = ItemCatalog 'all_equipment' (deduped equipment incl. crafted items),
    sorted ascending by stable item id. Because the catalog grows append-only
    (new items get higher ids), the id-sorted order is stable: the engine's
    seeded pick is reproducible for past dates and identical across clients.
    """
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    from ui.catalog import ItemCatalog
    cat = ItemCatalog()
    activity_names = getattr(cat, '_activity_drop_names', set()) or set()
    chest_names = getattr(cat, '_chest_item_names', set()) or set()
    shop_names = getattr(cat, '_shop_item_names', set()) or set()
    achievement_names = getattr(cat, '_achievement_reward_names', set()) or set()
    ap_names = getattr(cat, '_ap_reward_names', set()) or set()
    faction_names = getattr(cat, '_faction_reward_names', set()) or set()

    pool = cat.categories.get('all_equipment', []) or []
    items: List[Dict] = []

    def _entry(item_id, name, icon, rarity, slot, value, sources, skills,
               keywords, stats_dict, requirements, quality):
        skills_set, stat_names = _flatten_stats(stats_dict)
        rarity = (rarity or 'common').lower()
        # Relabel the "chest" equipment slot to "body" so it doesn't collide
        # with the "chest" (treasure-chest) source token in the Source column.
        slot_label = (slot or '').lower()
        if slot_label == 'chest':
            slot_label = 'body'
        q = (quality or '').lower() or None
        rarity_index = RARITY_ORDER.index(rarity) if rarity in RARITY_ORDER else 0
        quality_index = QUALITY_ORDER.index(q) if q in QUALITY_ORDER else None
        # Unified tier: crafts use their quality (Normal..Eternal -> 0..5),
        # loot uses its rarity (common..ethereal -> 0..5). Same 0..5 scale so
        # the single "Rarity" hint column compares crafts and loot consistently.
        tier_index = quality_index if quality_index is not None else rarity_index
        level_req, level_display = _requirement_summary(requirements)
        # Requirement KIND so the engine can tell a flat skill level from a
        # category percentage even when their numeric value is equal (e.g.
        # "45% artisan" vs level 45). Derived from the controlled display form.
        if '%' in level_display:
            level_kind = 'percent'
        elif level_display == '—':
            level_kind = 'none'
        else:
            level_kind = 'level'
        return {
            'id': item_id,
            'name': name,
            'icon': icon,
            'rarity': rarity,
            'rarity_index': rarity_index,
            'slot': slot_label,
            'value': int(value or 0),
            'sources': sources,
            'skills': sorted(skills_set),
            'keywords': keywords,
            'stat_count': len(stat_names),
            'level_req': level_req,
            'level_display': level_display,
            'level_kind': level_kind,
            'quality': quality if quality else None,
            'quality_index': quality_index,
            'tier': quality if quality else rarity,
            'tier_index': tier_index,
        }

    for it in pool:
        item_id = it.get('id')
        name = it.get('name')
        if not item_id or not name:
            continue

        sources = _derive_sources(it, activity_names, chest_names, shop_names,
                                  achievement_names, ap_names, faction_names)
        keywords = sorted({str(k).lower() for k in (it.get('keywords') or []) if k})
        icon = it.get('icon_path')
        slot = it.get('slot')
        value = it.get('value')
        reqs = it.get('requirements')

        stats_by_quality = it.get('stats_by_quality')
        if it.get('type') == 'crafted_item' and isinstance(stats_by_quality, dict) and stats_by_quality:
            # Crafted items differ by quality (Normal..Eternal); emit one
            # guessable entry per quality so the player can pick the quality.
            # The coin value is per-quality (e.g. Oak fishing rod is 6 at Normal
            # but 256 at Eternal); use quality_values, falling back to the base
            # value only when a quality is missing from the table.
            quality_values = it.get('quality_values') or {}
            # Non-craft sources (activity drop / shop buy / chest / reward) give
            # an item at a FIXED quality -- Normal for craftable gear (drops,
            # shops and chests yield Normal; higher qualities are obtainable
            # only by crafting). The name-based source sets can't distinguish
            # quality, so we'd otherwise stamp e.g. "activity" onto every quality
            # variant. Restrict every non-'crafted' source to the Normal entry;
            # all qualities keep 'crafted'.
            craft_only = ['crafted'] if 'crafted' in sources else []
            for quality_name, q_stats in stats_by_quality.items():
                q_id = f"{item_id}__{str(quality_name).lower()}"
                q_value = quality_values.get(quality_name, value)
                q_sources = sources if quality_name == 'Normal' else craft_only
                items.append(_entry(q_id, name, icon, 'common', slot, q_value,
                                    q_sources, None, keywords, q_stats, reqs, quality_name))
        else:
            items.append(_entry(item_id, name, icon, it.get('rarity'), slot, value,
                                sources, None, keywords, it.get('stats'), reqs, None))

    # Stable id-sorted order is the contract the daily seed relies on.
    items.sort(key=lambda x: x['id'])
    _CACHE = items
    return items


def reset_cache():
    """Clear the module cache (tests / catalog reloads)."""
    global _CACHE
    _CACHE = None
