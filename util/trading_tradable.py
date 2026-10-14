#!/usr/bin/env python3
"""Trading: pure tradable-item derivation.

The game has an authoritative "tradable" flag but the public API does not
expose it, so we derive tradability from the catalog item's `type`
(see .kiro/specs/trading/requirements.md Req 6 and design.md §5).

Catalog `type` strings (from ui/catalog.py) map to tradability as:
  tradable     : material, crafted_item, consumable, egg (pet egg), item (gear/tool/loot), coins
  NOT tradable : collectible, container (chests), achievement_item, pet

Bank location is intentionally NOT a tradability gate — it is a warn-only
concern handled at listing time (Req 7), so it is not an input here.
"""

from typing import Dict, Optional

# Item `type` values that are tradable. Includes BOTH catalog types (material,
# crafted_item, consumable, egg, item) and their canonical wire forms (crafted,
# pet_egg) so is_tradable works on catalog items AND listing/wishlist payloads.
# 'item' = equipment (gear/tool) + loot; 'coins' = the coins commodity.
TRADABLE_TYPES = frozenset({
    "material", "crafted_item", "crafted", "consumable",
    "egg", "pet_egg", "item", "gear", "tool", "loot", "coins",
})

# Explicit non-tradable catalog types (kept for clarity + tests).
NON_TRADABLE_TYPES = frozenset({"collectible", "container", "achievement_item", "pet"})

# Keyword-based exclusions: some non-tradable items share a tradable TYPE
# (e.g. memospheres are typed 'consumable'), so gate them by keyword too.
NON_TRADABLE_KEYWORDS = frozenset({"memosphere"})


def is_tradable(item: Dict, *, is_claimed_egg: Optional[bool] = None) -> bool:
    """Return whether a catalog item (or wire payload) is tradable.

    Authoritative source is the game's `canBeTraded` flag (tools API detailed
    response, stamped onto catalog items from ITEM_TRADE_FLAGS). When present it
    WINS over the legacy type heuristic. Listing/wishlist wire payloads don't
    carry the flag, so they fall back to the type/keyword heuristic.

    The per-character `is_claimed_egg` refinement still makes a pet egg
    non-tradable once claimed (Req 6.4).
    """
    item = item or {}
    can_be_traded = item.get("canBeTraded")
    if can_be_traded is not None:
        if not can_be_traded:
            return False
        if item.get("type") in ("egg", "pet_egg"):
            return not bool(is_claimed_egg)
        return True
    # ---- legacy fallback: items/payloads without the authoritative flag ----
    kws = {str(k).lower() for k in (item.get("keywords") or [])}
    if kws & NON_TRADABLE_KEYWORDS:
        return False
    item_type = item.get("type")
    if item_type in ("egg", "pet_egg"):
        # Pet eggs are a tradable class; a *claimed* egg is not tradable.
        return not bool(is_claimed_egg)
    return item_type in TRADABLE_TYPES
