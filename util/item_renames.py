"""Historical item id / export-name renames (old id -> new canonical id).

When the game (and the WalkScape Tools API) renames an item, both its export
name AND its canonical catalog id change -- e.g. ``travelers_kit`` became
``travellers_kit`` when "Traveler's kit" was respelled "Traveller's kit".

A user's previously-saved state (owned_items, plus per-item hide/quality
overrides in ui_config) is keyed by the OLD id. After a rename the old id no
longer matches any catalog item, so a previously-owned/checked item silently
shows up UNCHECKED. This map migrates those stale old keys to the new canonical
id at load time.

Why this can't be derived automatically from the current catalog:
``ui/app.py`` builds an ``export_aliases`` map from
``export_names.get_item_mapping()`` for items whose *current* export name
differs from their canonical id. That only works while the old name still
EXISTS in the mapping. A true rename removes the old name entirely, so there is
nothing left to alias from -- the historical old->new pair must be recorded
explicitly here.

MAINTENANCE: whenever a scrape reports an id-changing rename (see the stale
old-id cache purge in ``ingest_items_from_tools_api.run``), add the
``old_id: new_id`` pair here so existing users' saved state survives the rename.
Keys and values are canonical ids (lowercased, spaces -> ``_``, parens/hyphens
/apostrophes stripped) -- the same shape ``export_aliases`` uses.
"""

# old canonical id / export name  ->  new canonical id
ITEM_RENAMES = {
    # 2026-08-05 game patch respellings
    "travelers_kit": "travellers_kit",              # Traveler's kit -> Traveller's kit
    "adventuring_guild_chip": "adventurers_guild_chip",    # Adventuring Guild chip -> Adventurers' Guild chip
    "adventuring_guild_chest": "adventurers_guild_chest",  # Adventuring Guild chest -> Adventurers' Guild chest
    # 2026-08-11: additional renames found as orphan item_ids rows
    "adventurers_guild_buckler": "adventuring_buckler",    # Adventurers' Guild buckler -> Adventuring buckler
    "camouflage_cape": "leaf_cape",                        # Camouflage cape -> Leaf cape
}


def get_item_renames() -> dict:
    """Return the historical old-id -> new-id rename map (a fresh copy)."""
    return dict(ITEM_RENAMES)
