"""Hunting fine-input flat bonus.

Feeding *fine* input items (e.g. fine arrows) to a Hunting activity grants a
flat activity bonus in-game. The fine MATERIAL variants themselves carry no
stats of their own (e.g. ``Copper arrows (Fine)`` has an empty ``_stats``), so
this flat bonus is the model for their effect. This module is the single source
of truth for that bonus so the standalone activity view (ui/app.py) and the
crafting-tree stat paths (ui/crafting_tree.py) stay in sync.

Only Hunting activities that consume a *keyword*-type input (arrows, etc.)
benefit — fine variants of non-hunting inputs (e.g. Fine Fabric for sail
repair) have identical stats to their normal counterpart, so the bonus must NOT
be applied for them. See bug 8cb1876f.
"""
from __future__ import annotations

# The flat stat bonus granted when fine inputs are used on an eligible hunting
# activity. Keep in sync with any UI copy describing the feature.
FINE_INPUT_BONUS = {
    "work_efficiency": 0.40,
    "double_rewards": 0.10,
    "bonus_xp_percent": 1.00,
    "fine_material_finding": 2.00,
}


def activity_benefits_from_fine_inputs(activity) -> bool:
    """True iff `activity` is a Hunting activity with a keyword-type input.

    These are the only activities for which fine inputs grant the flat bonus.
    """
    if not activity:
        return False
    if (getattr(activity, "primary_skill", None) or "").lower() != "hunting":
        return False
    input_items = getattr(activity, "input_items", None)
    if not input_items:
        return False
    return any(getattr(ii, "type", "") == "keyword" for ii in input_items)


def apply_fine_input_bonus(stats: dict, activity, use_fine_inputs: bool) -> dict:
    """Add the hunting fine-input flat bonus to ``stats`` in place when enabled.

    No-op unless ``use_fine_inputs`` is truthy AND the activity is a Hunting
    activity with a keyword input (see ``activity_benefits_from_fine_inputs``).
    Returns the same ``stats`` dict for convenience.
    """
    if not use_fine_inputs or not activity_benefits_from_fine_inputs(activity):
        return stats
    for stat_name, delta in FINE_INPUT_BONUS.items():
        stats[stat_name] = stats.get(stat_name, 0.0) + delta
    return stats
