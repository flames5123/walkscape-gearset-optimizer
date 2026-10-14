#!/usr/bin/env python3
"""Trading: business-logic helpers shared by the local API and federation.

Task-3 scope: canonical (tool-neutral) item identity + transaction/object-id
helpers. Quality matching, name->session resolution, and federation mapping
land in their own tasks (see .kiro/specs/trading/tasks.md).
"""

import time
from typing import Dict, Optional

from ui.crafting_tree import _slug_item_name

#: where account_id is the private session UUID (OK to emit — it is this site's
#: stable account handle, not a secret). object_id = "{ORIGIN_SITE}:{local_id}".
ORIGIN_SITE = "flames"

# Map catalog `type` strings to the tool-neutral canonical `type` used on the
CANONICAL_TYPE = {
    "material": "material",
    "crafted_item": "crafted",
    "consumable": "consumable",
    "egg": "pet_egg",
    "item": "item",          # equipment (gear/tool) + loot (activity/chest/shop)
    "coins": "coins",
}


def now_ms() -> int:
    """Unix-epoch milliseconds — the transaction id (txn_id) for every mutation."""
    return int(time.time() * 1000)


def make_object_id(local_id, prefix: str = "", origin_site: str = ORIGIN_SITE) -> str:
    """Build a globally-unique object id, e.g. ``walkscape-opt:L1024``."""
    return f"{origin_site}:{prefix}{local_id}"


def parse_object_id(object_id: str):
    """Split an object id into ``(origin_site, local_ref)``."""
    origin, _, local_ref = (object_id or "").partition(":")
    return origin, local_ref


def public_trader_id(account_id: str, origin_site: str = ORIGIN_SITE) -> str:
    """Public cross-site trader identity: ``{origin_site}:{account_id}``.

    ``account_id`` is this site's stable per-trader handle (our session UUID).
    The in-game name is a separate, UNVERIFIED display label — never an id.
    """
    return f"{origin_site}:{account_id}"


def canonical_item(item: Dict, key: str, quality: str = "") -> Dict[str, str]:
    """Return the tool-neutral ``{slug, type, quality}`` triple for an item.

    ``key`` is the game's internal item key EXACTLY as the profile export writes
    it (e.g. ``birch_logs``, ``letter_from_a._a.``) — NOT a slug built from the
    display name (name slugs diverge: ``oak_log`` vs ``oak_logs``). It is carried
    in the ``slug`` field for wire-compat. ``quality`` is the game variant token
    ('' = base/no-variant, ``common``..``ethereal``, ``fine``).
    """
    raw_type = (item or {}).get("type", "")
    return {
        "slug": key,
        "type": CANONICAL_TYPE.get(raw_type, raw_type),
        "quality": quality or "",
    }


# ── Quality variant model (game-native tokens) ───────────────────────────────
# The game profile export encodes an item's variant as a suffix on the export
# key: no suffix = base, ``_common``..``_ethereal`` for the six rarity tiers,
# ``_fine`` for fine materials/consumables. We store that token verbatim:
#   '' (base) | common | uncommon | rare | epic | legendary | ethereal | fine
QUALITY_VARIANTS = ("", "common", "uncommon", "rare", "epic", "legendary", "ethereal", "fine")

# Rarity-tier suffix <-> token (identity map; kept explicit for clarity + import parsing).
RARITY_TOKENS = ("common", "uncommon", "rare", "epic", "legendary", "ethereal")

# Per-canonical-type ascending ladders (variant tokens) for this_or_better.
QUALITY_LADDERS = {
    "crafted": list(RARITY_TOKENS),
    "item": list(RARITY_TOKENS),       # gear/tool carry a fixed rarity tier
    "consumable": ["", "fine"],
    "material": ["", "fine"],
    "pet_egg": ["", "rare"],
}

# Human display label for a (canonical_type, token). Crafted/gear rarity tiers
# read as the game's quality words; eggs/materials/consumables use their own.
_CRAFTED_DISPLAY = {
    "common": "Normal", "uncommon": "Good", "rare": "Great",
    "epic": "Excellent", "legendary": "Perfect", "ethereal": "Eternal",
}


def quality_display(canonical_type: str, token: str) -> str:
    """Human label for a variant token given the item's canonical type.
    Returns '' for the base/no-variant token (caller shows no suffix)."""
    token = token or ""
    if canonical_type in ("crafted", "item"):
        return _CRAFTED_DISPLAY.get(token, "")
    if canonical_type == "pet_egg":
        return "Rare" if token == "rare" else ""
    if token == "fine":
        return "Fine"
    return ""


_QUALITY_WORD_TO_TOKEN = {
    "good": "uncommon", "great": "rare", "excellent": "epic",
    "perfect": "legendary", "eternal": "ethereal",
}
_BASE_QUALITY_SYNONYMS = {"", "normal", "none", "any"}


def _norm_quality_token(token: str, canonical_type: str) -> str:
    """Map a stored/display quality value to the canonical ladder token for the
    item's type. Handles display words ('perfect'->'legendary') and base
    synonyms ('normal'/'none'/'' -> the ladder's base token) so matching is
    consistent no matter how the value was saved."""
    t = (token or "").strip().lower()
    ladder = QUALITY_LADDERS.get(canonical_type) or [""]
    base = ladder[0]
    if t in _QUALITY_WORD_TO_TOKEN:
        t = _QUALITY_WORD_TO_TOKEN[t]
    if t in _BASE_QUALITY_SYNONYMS:
        return base
    if t == "common" and "common" not in ladder:
        return base
    return t


def quality_matches(listing_quality: str, rule: str, floor: str, canonical_type: str) -> bool:
    """Does a listing's quality satisfy a wishlist entry's quality rule?

    ``rule`` is ``exact`` or ``this_or_better``; ``floor`` is the wishlist's
    anchor tier; comparison stays within the item's own ladder (no cross-class).
    Items with no ladder (materials, chest/activity items, coins) match on
    identity only.

    Both inputs are normalized first (``_norm_quality_token``) so a floor saved
    as a display word ('Perfect') or a base synonym ('normal'/'none'/'') matches
    the canonical ladder token — e.g. a material wishlist floored at 'normal'
    matches a base ('') listing. Without this the alert path (strict) disagreed
    with the wishlist "match" badge (lenient), so matches showed but never
    notified.
    """
    lq = _norm_quality_token(listing_quality, canonical_type)
    fl = _norm_quality_token(floor, canonical_type)
    if rule != "this_or_better":
        return lq == fl
    ladder = QUALITY_LADDERS.get(canonical_type)
    if not ladder:
        return lq == fl
    try:
        return ladder.index(lq) >= ladder.index(fl)
    except ValueError:
        return lq == fl


# ── Bank-location detection (Req 7 / design §6) ──────────────────────────────
def _collect_slugs(node, out: set) -> None:
    """Recursively collect slugged item identifiers from an import section.

    Handles the common shapes: ``{slug: qty}`` maps (keys are items),
    nested category dicts, and lists of item-name strings.
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(key, str):
                out.add(_slug_item_name(key))
            _collect_slugs(value, out)
    elif isinstance(node, list):
        for value in node:
            if isinstance(value, (dict, list)):
                _collect_slugs(value, out)
            elif isinstance(value, str):
                out.add(_slug_item_name(value))


def item_location(character_config: Dict, item_slug: str) -> str:
    """Classify an owned item's location as bank | inventory | equipped | none.

    Warn-only (Req 7 never hard-blocks); best-effort over the import's separate
    ``bank`` / ``inventory`` / ``gear`` sections.
    """
    cc = character_config or {}
    bank, inv, gear = set(), set(), set()
    _collect_slugs(cc.get("bank"), bank)
    _collect_slugs(cc.get("inventory"), inv)
    for k in ("gear", "equipped", "equipment"):
        _collect_slugs(cc.get(k), gear)
    if item_slug in bank:
        return "bank"
    if item_slug in inv:
        return "inventory"
    if item_slug in gear:
        return "equipped"
    return "none"
