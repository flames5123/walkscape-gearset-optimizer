"""normalize — canonical item-id normalization shared across stale detection.

SINGLE SOURCE OF TRUTH for turning a display name like ``'99-year-old wine'``
into its snake_case id (``'99_year_old_wine'``). Both the write side
(``stats_report_worker`` — builds the ownership lookup and the new_items jobs)
and the read/enumerate side (``applicable_sources`` / ``state_snapshot`` — the
newly-unlocked stale-badge path) MUST normalize with this exact function.

Why this lives here (util) and not in ui/stats_report_worker.py:
``stats_report_worker`` already imports from ``util.stats_report``; if the
enumerator imported the normalizer from the worker we'd have a circular import.
Putting the canonical transform in util lets the worker delegate to it without
inverting the dependency direction.

Bug history (jwbail 2026-06-22, report 2316c608): the enumerator used a weaker
transform (``.lower().replace(' ', '_').replace("'", '')``) that did NOT drop
hyphens / slashes / unicode apostrophes or collapse repeated underscores, while
the worker used the full transform below. For ``'99-year-old wine'`` the worker
produced ``'99_year_old_wine'`` (matched the owned collectible → no job → no
result row) but the enumerator produced ``'99-year-old_wine'`` (no match →
unowned → emitted the scope as applicable). The scope was therefore in the
applicable set with no result row, so ``detect_stale_scopes`` flagged it
NEWLY_UNLOCKED forever and the (!) never cleared. Unifying on one function
removes the entire class of normalization-mismatch stale badges.
"""


def normalize_item_id(name: str) -> str:
    """Convert a display name like 'Old copper ring' to its lowercase
    snake-case id ('old_copper_ring'). Mirrors the convention the
    UI uses for keys in character_config.items.
    """
    if not name:
        return ''
    s = str(name).lower()
    # Drop apostrophes ("adventurer's enamel pin" -> "adventurers enamel pin")
    s = s.replace("'", '').replace('\u2019', '')
    # Replace separators with underscore
    for ch in (' ', '-', '/'):
        s = s.replace(ch, '_')
    # Collapse repeated underscores
    while '__' in s:
        s = s.replace('__', '_')
    return s.strip('_')
