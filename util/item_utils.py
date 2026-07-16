#!/usr/bin/env python3
"""
Shared utility classes for items, quantities, and drop tables.
Used by activities, containers, and other systems.
"""

from typing import Optional, Any
from dataclasses import dataclass


@dataclass
class Quantity:
    """Represents item quantity (static, range, or N/A)."""
    min_qty: Optional[int] = None
    max_qty: Optional[int] = None
    is_na: bool = False
    
    @property
    def is_static(self) -> bool:
        return self.min_qty is not None and self.min_qty == self.max_qty
    
    @property
    def is_range(self) -> bool:
        return self.min_qty is not None and self.max_qty is not None and self.min_qty != self.max_qty
    
    @property
    def average(self) -> float:
        """Calculate average quantity."""
        if self.is_na:
            return 0.0
        if self.is_static:
            return float(self.min_qty)
        if self.is_range:
            return (self.min_qty + self.max_qty) / 2.0
        return 0.0
    
    def __str__(self) -> str:
        if self.is_na:
            return "N/A"
        if self.is_static:
            return str(self.min_qty)
        if self.is_range:
            return f"{self.min_qty}-{self.max_qty}"
        return "Unknown"


@dataclass
class DropEntry:
    """Represents a single drop table entry.
    
    Drop chance can be specified two ways:
    1. Raw API values (preferred): no_drop_chance + row_weight + table_weight
       - chance_percent is auto-computed in __post_init__
    2. Legacy/wiki: chance_percent set directly as a float
    
    The chance_percent field always has the correct value regardless of source.
    """
    item_name: str
    item_ref: Optional[str] = None  # String like "Material.RAW_SALMON"
    quantity: Optional[Quantity] = None
    # Raw API drop parameters (from gear.walkscape.app)
    no_drop_chance: Optional[float] = None  # 0.0 to 1.0, probability of nothing dropping
    row_weight: Optional[float] = None      # This item's weight in the loot table
    table_weight: Optional[float] = None    # Sum of all row weights in the same table
    # Drop chance as percentage - auto-computed from raw fields if they're set
    chance_percent: Optional[float] = None
    bonus_xp: Optional[int] = None  # Bonus XP for this drop (level-based activities)
    # Level-based drop parameters (optional, only for activities with level-scaling drops)
    initial_level: Optional[int] = None
    max_chance_level: Optional[int] = None
    final_chance: Optional[float] = None
    # Multi-roll parameters (e.g., "Does 100 rolls" - displayed chance is after N rolls)
    multi_roll_count: Optional[int] = None  # Number of rolls per action completion
    _cached_item: Optional[Any] = None
    
    def __post_init__(self):
        """Auto-compute chance_percent from raw API fields if available."""
        if self.no_drop_chance is not None and self.row_weight is not None and self.table_weight is not None:
            if self.chance_percent is None:
                if self.table_weight == 0:
                    self.chance_percent = 0.0
                else:
                    self.chance_percent = (1.0 - self.no_drop_chance) * (self.row_weight / self.table_weight) * 100.0
    
    @property
    def is_multi_roll(self) -> bool:
        """Check if this drop uses multi-roll mechanics (e.g., 'Does 100 rolls')."""
        return self.multi_roll_count is not None and self.multi_roll_count > 1
    
    @property
    def base_roll_chance(self) -> Optional[float]:
        """Get the per-roll base chance (as a decimal, not percent).

        chance_percent is auto-computed in __post_init__ as
            (1 - no_drop_chance) * (row_weight / table_weight) * 100
        which is ALREADY the per-roll chance — the row_weight ratio is the
        probability that a single roll on the table picks this entry. The
        activity's `rollAmount` (== multi_roll_count) is how many independent
        rolls are made on the table per action, so multi-roll drops just
        multiply the per-roll chance by N.

        Historically this property reverse-engineered a per-roll chance from
        chance_percent under the (wrong) assumption that the displayed
        chance_percent was the COMPOUND chance after N rolls. Bonez565 bug
        report 424b34f7 (2026-05-17): "Main table rolls for hunting with
        inputs are double expected steps (not rolling twice)" — that's the
        ratio between per-roll (correct) and the reverse-engineered value
        (wrong). The JS column-3 info section in drops-section.js never had
        this bug; it always treated chance_percent as per-roll for multi-roll
        drops. This property now matches the JS behavior so the crafting
        tree's expected steps line up with what the info section shows.
        """
        if not self.chance_percent:
            return None
        return self.chance_percent / 100.0
    
    @property
    def is_level_based(self) -> bool:
        """Check if this is a level-based drop."""
        return (self.initial_level is not None and 
                self.max_chance_level is not None and 
                self.final_chance is not None)
    
    def calculate_weight(self, level: int) -> float:
        """Calculate the level-scaled pseudo-weight for a level-based drop.

        A ramping drop's weight scales linearly with skill level from a small
        "start" value at ``initial_level`` up to its full ``final_chance`` at
        ``max_chance_level``. ``final_chance`` is the resolved max-level chance
        (computed from the gear-API row/table weights); the per-level
        normalisation in ``get_chance_at_level`` turns these weights back into
        displayed percentages. This matches the live game/tool exactly:
        e.g. Sea fishing (Net) at Fishing 31 -> jellyfish 6.8%, pink pearl
        0.204%, shrimp 67.996%.

        Formula (see .kiro/steering/LEVEL_BASED_DROPS.md):
            weight(level) = final_chance * (level - initial_level + 1)
                                          / (max_chance_level - initial_level)
        Rows that reach full weight immediately have
        ``max_chance_level == initial_level`` and short-circuit to full weight.
        """
        if not self.is_level_based:
            return 0.0

        if level < self.initial_level:
            return 0.0
        elif level >= self.max_chance_level:
            return self.final_chance
        else:
            # initial_level <= level < max_chance_level, so the span is >= 1.
            span = self.max_chance_level - self.initial_level
            ratio = (level - self.initial_level + 1) / span
            if ratio > 1.0:
                ratio = 1.0
            return self.final_chance * ratio
    
    def get_chance_at_level(self, level: int, total_weight: float, non_level_weighted_percent: float = 10.0) -> float:
        """Get drop chance at given level."""
        if self.is_level_based:
            weight = self.calculate_weight(level)
            if total_weight == 0:
                return 0.0
            return (weight / total_weight) * (100.0 - non_level_weighted_percent)
        else:
            return self.chance_percent or 0.0
    
    @property
    def item_object(self) -> Optional[Any]:
        """Lazily resolve and cache item reference."""
        if self._cached_item is not None or not self.item_ref:
            return self._cached_item
        from util.autogenerated.equipment import Item
        from util.autogenerated.materials import Material
        from util.autogenerated.consumables import Consumable
        from util.autogenerated.collectibles import Collectible
        from util.autogenerated.containers import Container
        from util.autogenerated.currency import Currency
        self._cached_item = eval(self.item_ref)
        return self._cached_item


# ============================================================================
# Item Finding (IF) helpers — shared by the optimizer + crafting tree
# ============================================================================
#
# Bugs 79ec57d9 + af9d3e86 (2026-05-31): when a recipe's output_item or an
# activity's target is also dropped by an `ItemFindingCategory.X` stat (e.g.
# Spectral gear's `ItemFindingCategory.ECTOPLASM`), the bonus drops weren't
# being credited:
#   - the crafting tree's `drops_gained` ignored IF expansions, so the side-
#     drops summary never showed the bonus item
#   - `calculate_craft_metrics` didn't reduce required crafts/steps for IF
#     bonuses on the recipe target, so gear like Ghost trap pack lost to
#     Backpack on a recipe whose whole point is Ectoplasm
#
# These helpers centralise the IF expansion math so every consumer agrees:
#   - `if_target_bonus_per_roll(stats, target_ref)` → fractional drops of
#     `target_ref` per reward roll from all IF stats. Apply via
#     `(1+DA)*(1+DR)` to convert to per-action yield, or scale
#     `output_qty / (output_qty + bonus)` to convert "primary outputs per
#     completed action" into a per-target steps multiplier.
#   - `iter_if_drops_per_roll(stats)` → yields (item_ref, qty_per_roll)
#     for every IF stat. Used by drop-yield iterators that already apply
#     `(1+DA)*(1+DR)` once per drop entry.


def _drop_avg_qty(quantity) -> float:
    """Resolve a Quantity (or None) to its average expected value."""
    if quantity is None or getattr(quantity, 'is_na', False):
        return 0.0
    if getattr(quantity, 'is_static', False):
        return float(quantity.min_qty or 0)
    return (float(quantity.min_qty or 0) + float(quantity.max_qty or 0)) / 2.0


def if_target_bonus_per_roll(stats, target_item_ref) -> float:
    """Return fractional drops of `target_item_ref` per reward roll from IF stats.

    Walks every `ItemFindingCategory.X` entry in `stats`, looks up the
    matching category, and accumulates `(stat_value/100) * (drop.chance%/100)
    * avg_qty` for each drop whose `item_ref` matches `target_item_ref`.

    Reward rolls are `(1+DA)*(1+DR)` per paid action, so the caller scales
    this value to whatever yield convention they need.

    Returns 0.0 when `target_item_ref` is empty, no IF stats are set, or
    the IF data isn't importable.
    """
    if not target_item_ref or not stats:
        return 0.0
    try:
        from util.autogenerated.item_finding import ItemFindingCategory
    except ImportError:
        return 0.0
    total = 0.0
    for stat_name, stat_value in stats.items():
        if not isinstance(stat_name, str) or not stat_name.startswith('ItemFindingCategory.'):
            continue
        if not stat_value or stat_value <= 0:
            continue
        cat_const = stat_name.split('.', 1)[1]
        category = getattr(ItemFindingCategory, cat_const, None)
        if category is None:
            continue
        for drop in (getattr(category, 'drops', None) or []):
            if getattr(drop, 'item_ref', None) != target_item_ref:
                continue
            avg_qty = _drop_avg_qty(getattr(drop, 'quantity', None))
            chance_pct = float(getattr(drop, 'chance_percent', 0) or 0)
            if avg_qty <= 0 or chance_pct <= 0:
                continue
            total += (float(stat_value) / 100.0) * (chance_pct / 100.0) * avg_qty
            break  # one drop per category counts (matches activity engine)
    return total


def iter_if_drops_per_roll(stats):
    """Yield (item_ref, qty_per_roll) tuples for every IF expansion.

    `qty_per_roll = (stat_value/100) * (drop.chance%/100) * avg_qty`. The
    caller multiplies by `(1+DA)*(1+DR)` to get yield per paid action.

    Mirrors the IF expansion in `ActivityInfo.get_expected_drop_rate` and
    `util/coin_value._collect_activity_drops_with_equipment` so per-node
    drop yields, side-drops summaries, and the coin scorer all agree on
    what an IF stat actually drops.
    """
    if not stats:
        return
    try:
        from util.autogenerated.item_finding import ItemFindingCategory
    except ImportError:
        return
    for stat_name, stat_value in stats.items():
        if not isinstance(stat_name, str) or not stat_name.startswith('ItemFindingCategory.'):
            continue
        if not stat_value or stat_value <= 0:
            continue
        cat_const = stat_name.split('.', 1)[1]
        category = getattr(ItemFindingCategory, cat_const, None)
        if category is None:
            continue
        for drop in (getattr(category, 'drops', None) or []):
            ref = getattr(drop, 'item_ref', None)
            if not ref:
                continue
            avg_qty = _drop_avg_qty(getattr(drop, 'quantity', None))
            chance_pct = float(getattr(drop, 'chance_percent', 0) or 0)
            if avg_qty <= 0 or chance_pct <= 0:
                continue
            qty_per_roll = (float(stat_value) / 100.0) * (chance_pct / 100.0) * avg_qty
            if qty_per_roll > 0:
                yield ref, qty_per_roll


def if_stat_names_for_target(target_item_ref):
    """Return the set of `ItemFindingCategory.X` stat keys whose category
    drops `target_item_ref`.

    Used to extend the optimizer's `relevant_stats` so gear whose only
    relevant contribution is an IF category that drops the recipe's
    output (e.g. Spectral vest for Material.ECTOPLASM) stays in the
    candidate pool. Without this the dominance prefilter discards the
    item before scoring.
    """
    out = set()
    if not target_item_ref:
        return out
    try:
        from util.autogenerated.item_finding import ItemFindingCategory
    except ImportError:
        return out
    for attr_name in dir(ItemFindingCategory):
        if attr_name.startswith('_'):
            continue
        category = getattr(ItemFindingCategory, attr_name, None)
        drops = getattr(category, 'drops', None) if category is not None else None
        if not drops:
            continue
        for drop in drops:
            if getattr(drop, 'item_ref', None) == target_item_ref:
                out.add(f'ItemFindingCategory.{attr_name}')
                break
    return out
