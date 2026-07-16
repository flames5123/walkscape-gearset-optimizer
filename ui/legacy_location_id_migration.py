"""Legacy location-id migration helper.

When the WalkScape tools API renames a location id (e.g.
``blackspell_port`` → ``blackspell_harbour`` on 2026-05-28), user data
saved with the old id will no longer match the API or the regenerated
``Location`` enum. Without a migration, saved column-3 location
selections, travel start/end choices, comparison-mode contexts, and
crafting-tree node location overrides silently drop to ``null`` after
the rename ships.

This module ships a single one-time, in-place rewrite of those legacy
ids that runs the next time a session is hydrated by the backend. The
rewrite is:

  * **Targeted** — only fields whose key obviously refers to a location
    are touched (``selectedLocation``, ``travelStart``, ``travelEnd``,
    ``selected_location_id``, ``location``). Other strings that happen
    to equal a legacy id are left alone.
  * **Recursive** — walks lists and nested dicts, so it covers
    ``ui_config.column3Selection.selectedLocation``,
    ``ui_config.gearsets.gs1Context.selectedLocation``, and any
    crafting-tree node lists nested inside ``ui_config``.
  * **Idempotent** — once the migration has rewritten a value, the new
    id is not in :data:`LEGACY_LOCATION_ID_RENAMES`, so a second run is
    a no-op. Safe to call on every session hydrate.
  * **Persisted** — callers should write the migrated ``ui_config``
    back to the DB so the rewrite happens exactly once per session.

To register a future rename, add an entry to
:data:`LEGACY_LOCATION_ID_RENAMES`. No alias map ships with the
``Location`` enum or the emitter — the legacy ids exist only here as a
historical record.
"""

from __future__ import annotations

from typing import Any, Dict


# Map of NEW api id -> OLD api id pairs that legacy session data may
# reference. Order is irrelevant; lookups are by old → new.
LEGACY_LOCATION_ID_RENAMES: Dict[str, str] = {
    'blackspell_port': 'blackspell_harbour',
}


# Dict-key heuristics: only rewrite a string value if its enclosing key
# matches one of these (case-insensitive substring match). This keeps
# the walker from rewriting unrelated strings that happen to equal a
# legacy id.
_LOCATION_KEY_TOKENS = (
    'location',     # selectedLocation, location, selected_location_id, …
    'travelstart',  # travelStart
    'travelend',    # travelEnd
)


def _key_looks_like_location(key: str) -> bool:
    k = key.lower().replace('_', '')
    return any(tok in k for tok in _LOCATION_KEY_TOKENS)


def migrate_legacy_location_ids(payload: Any) -> bool:
    """Rewrite legacy location ids inside ``payload`` in place.

    Returns ``True`` if any value was rewritten (so the caller knows
    whether to persist the change back to the DB), ``False`` otherwise.
    Accepts ``ui_config`` dicts, ``tree_data`` dicts, or any
    JSON-shaped payload — the walker is generic.
    """
    changed = [False]

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                if (
                    isinstance(v, str)
                    and v in LEGACY_LOCATION_ID_RENAMES
                    and _key_looks_like_location(k)
                ):
                    obj[k] = LEGACY_LOCATION_ID_RENAMES[v]
                    changed[0] = True
                else:
                    walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(payload)
    return changed[0]
