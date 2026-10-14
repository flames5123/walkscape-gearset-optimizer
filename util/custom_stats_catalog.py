"""Canonical list of custom-stat IDs.

Single source of truth for the set of boolean custom stats the app exposes
(the GET /api/custom-stats options). Lives in a lightweight, dependency-free
module so optimizer workers (optimize_worker, travel_optimize_worker,
crafting_tree, stats_report_worker) can resolve "enable all stats" without
importing the whole FastAPI app module (``ui.app``), which would be heavy and
risks circular imports in detached worker processes.

Keep this in sync with GET /api/custom-stats in ui/app.py.
"""

# NOTE: order is not significant; membership is what matters.
ALL_CUSTOM_STAT_IDS = [
    'repair_the_bank',
    'screwdriver_underwater_basket_weaving',
    'screwdriver_tinkering',
    'classic_skiing',
    'skate_skiing',
    'underwater_swimming',
    'merfolk_dancing',
    'firewood_making',
    'jarvonia_skydisc_course',
    'twophointoh_hunt',
    'gdte_skydisc_course',
    'petal_finder_travel_steps_125000',
    'petal_finder_travel_steps_175000',
    'explored_realm_jarvonia',
    'explored_realm_gdte',
    'explored_realm_syrenthia',
    'explored_realm_wallisia',
    'explored_realm_wrentmark',
]


def get_all_custom_stat_ids():
    """Return a fresh list of all known custom-stat IDs."""
    return list(ALL_CUSTOM_STAT_IDS)


def apply_all_stats_override(custom_stats, enabled):
    """Return a custom_stats dict with every gate forced True when ``enabled``.

    Used by the "temporarily enable all stats" override so every optimizer
    resolves all custom-stat gates as satisfied for scoring. Non-destructive:
    returns a NEW dict layered over the caller's values (preserving unrelated
    keys like ``show_notification``); the caller's stored selections are never
    mutated. When ``enabled`` is falsy, the input is returned unchanged.
    """
    base = dict(custom_stats or {})
    if not enabled:
        return base
    for stat_id in ALL_CUSTOM_STAT_IDS:
        base[stat_id] = True
    return base
