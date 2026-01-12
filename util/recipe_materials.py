#!/usr/bin/env python3
"""
Helper functions to link recipe materials to actual Material and Item objects.
"""

from typing import Union, Optional, List, Tuple
from util.walkscape_constants import *


def normalize_name(name: str) -> str:
    """
    Normalize a material/item name to match the attribute naming convention.
    
    Examples:
        "Birch Logs" -> "BIRCH_LOGS"
        "Bronze bar" -> "BRONZE_BAR"
        "Iron Sickle" -> "IRON_SICKLE"
    """
    return name.upper().replace(' ', '_').replace("'", '').replace('-', '_')


def find_material(material_name: str) -> Optional[object]:
    """
    Find a material by name in the Material class.
    
    Args:
        material_name: Name of the material (e.g., "Birch Logs", "Bronze bar")
        
    Returns:
        Material object or None if not found
    """
    normalized = normalize_name(material_name)
    
    # Try exact match first
    if hasattr(Material, normalized):
        return getattr(Material, normalized)
    
    # Try without "FINE" suffix
    if normalized.endswith('_FINE'):
        base_name = normalized[:-5]
        if hasattr(Material, base_name):
            return getattr(Material, base_name)
    
    return None


def find_item(item_name: str) -> Optional[object]:
    """
    Find an item by name in the Item class.
    
    Args:
        item_name: Name of the item (e.g., "Iron Sickle", "Wooden Shield")
        
    Returns:
        Item object or None if not found
    """
    normalized = normalize_name(item_name)
    
    if hasattr(Item, normalized):
        return getattr(Item, normalized)
    
    return None


def find_consumable(consumable_name: str) -> Optional[object]:
    """
    Find a consumable by name in the Consumable class.
    
    Args:
        consumable_name: Name of the consumable (e.g., "Bread", "Cooked Fish")
        
    Returns:
        Consumable object or None if not found
    """
    normalized = normalize_name(consumable_name)
    
    if hasattr(Consumable, normalized):
        return getattr(Consumable, normalized)
    
    return None


def resolve_material(material_name: str) -> Optional[Union[object, object, object]]:
    """
    Resolve a material name to either a Material, Item, or Consumable object.
    
    Tries Materials first, then Items, then Consumables (since some recipes use crafted items or consumables as materials).
    
    Args:
        material_name: Name of the material/item/consumable
        
    Returns:
        Material, Item, or Consumable object, or None if not found
    """
    # Try materials first
    material = find_material(material_name)
    if material:
        return material
    
    # Try items (crafted items can be materials)
    item = find_item(material_name)
    if item:
        return item
    
    # Try consumables (some recipes use consumables as materials)
    consumable = find_consumable(material_name)
    if consumable:
        return consumable
    
    return None


def get_material_value(material_name: str) -> Optional[int]:
    """
    Get the coin value of a material or item.
    
    Args:
        material_name: Name of the material/item
        
    Returns:
        Coin value or None if not found
    """
    obj = resolve_material(material_name)
    if obj and hasattr(obj, 'value'):
        return obj.value
    return None


def validate_recipe_materials(recipe) -> Tuple[List[str], List[str]]:
    """
    Validate that all materials in a recipe can be resolved.
    
    Material structure: List of alternatives, where each alternative is a list of required materials.
    
    Args:
        recipe: Recipe object with materials list (list of alternatives)
        
    Returns:
        Tuple of (found_materials, missing_materials)
    """
    found = []
    missing = []
    
    # Check the first valid alternative
    for alternative_idx, alternative in enumerate(recipe.materials):
        alternative_valid = True
        for qty, material_obj in alternative:
            if material_obj and hasattr(material_obj, 'name'):
                found.append(material_obj.name)
            else:
                missing.append(f"Unknown material in alternative {alternative_idx}")
                alternative_valid = False
        
        # If we found a valid alternative, we're done
        if alternative_valid:
            break
    
    return found, missing


def calculate_material_cost(recipe, prefer_cheapest: bool = True) -> Optional[int]:
    """
    Calculate the total material cost for a recipe in coins.
    
    Material structure: List of alternatives, where each alternative is a list of required materials.
    - Outer list = alternative recipes (pick ONE)
    - Inner list = all materials for that alternative (ALL required)
    
    Examples:
    - [[(2, Wheat), (1, Milk)]] = 1 alternative: need 2 Wheat AND 1 Milk
    - [[(7, Gold nugget)], [(2, Gold ore)]] = 2 alternatives: need (7 Gold nugget) OR (2 Gold ore)
    - [[(1, A), (2, B)], [(1, C), (2, D)]] = 2 alternatives: need (1 A AND 2 B) OR (1 C AND 2 D)
    
    For recipes with multiple alternatives, selects based on prefer_cheapest:
    - If True: picks the cheapest alternative
    - If False: picks the first valid alternative
    
    Args:
        recipe: Recipe object with materials list (list of alternatives)
        prefer_cheapest: Whether to prefer cheapest materials when alternatives exist
        
    Returns:
        Total coin value of materials, or None if no valid alternative found
    """
    best_cost = None
    
    # Each element in recipe.materials is an ALTERNATIVE
    # Pick the best alternative
    for alternative in recipe.materials:
        if not alternative:
            continue  # Empty alternative
        
        # Calculate total cost of this alternative (sum all materials)
        alternative_cost = 0
        valid = True
        
        for qty, material_obj in alternative:
            if not material_obj or not hasattr(material_obj, 'value'):
                valid = False
                break
            alternative_cost += qty * material_obj.value
        
        if not valid:
            continue
        
        # Check if this is the best alternative
        if best_cost is None:
            best_cost = alternative_cost
        elif prefer_cheapest and alternative_cost < best_cost:
            best_cost = alternative_cost
        elif not prefer_cheapest:
            # Use first valid option
            break
    
    return best_cost


def get_recipe_materials_with_objects(recipe, prefer_cheapest: bool = True) -> List[Tuple[int, str, object]]:
    """
    Get recipe materials with their names and objects.
    
    Material structure: List of alternatives, where each alternative is a list of required materials.
    - Outer list = alternative recipes (pick ONE)
    - Inner list = all materials for that alternative (ALL required)
    
    Examples:
    - [[(2, Wheat), (1, Milk)]] = 1 alternative: need 2 Wheat AND 1 Milk
    - [[(7, Gold nugget)], [(2, Gold ore)]] = 2 alternatives: need (7 Gold nugget) OR (2 Gold ore)
    - [[(1, A), (2, B)], [(1, C), (2, D)]] = 2 alternatives: need (1 A AND 2 B) OR (1 C AND 2 D)
    
    For recipes with multiple alternatives, selects based on prefer_cheapest:
    - If True: picks the cheapest alternative
    - If False: picks the first valid alternative
    
    Args:
        recipe: Recipe object with materials list (list of alternatives)
        prefer_cheapest: Whether to prefer cheapest materials when alternatives exist
        
    Returns:
        List of (quantity, name, object) tuples for ALL materials in selected alternative
    """
    best_alternative_materials = None
    best_alternative_cost = None
    
    # Each element in recipe.materials is an ALTERNATIVE
    # Pick the best alternative
    for alternative in recipe.materials:
        if not alternative:
            continue  # Empty alternative
        
        # Calculate total cost and collect materials for this alternative
        alternative_materials = []
        alternative_cost = 0
        valid = True
        
        for qty, material_obj in alternative:
            if not material_obj or not hasattr(material_obj, 'name'):
                valid = False
                break
            
            alternative_materials.append((qty, material_obj.name, material_obj))
            
            if hasattr(material_obj, 'value'):
                alternative_cost += qty * material_obj.value
            else:
                valid = False
                break
        
        if not valid:
            continue
        
        # Check if this is the best alternative
        if best_alternative_materials is None:
            best_alternative_materials = alternative_materials
            best_alternative_cost = alternative_cost
        elif prefer_cheapest and alternative_cost < best_alternative_cost:
            best_alternative_materials = alternative_materials
            best_alternative_cost = alternative_cost
        elif not prefer_cheapest:
            # Use first valid option
            break
    
    # Return all materials from the selected alternative
    if best_alternative_materials:
        return best_alternative_materials
    else:
        return [(0, "No valid alternative found", None)]


def get_all_material_alternatives(recipe) -> List[List[Tuple[int, str, object, Optional[int]]]]:
    """
    Get all material alternatives for a recipe, showing all options.
    
    Material structure: List of alternatives, where each alternative is a list of required materials.
    - Outer list = alternative recipes (pick ONE)
    - Inner list = all materials for that alternative (ALL required)
    
    Args:
        recipe: Recipe object with materials list (list of alternatives)
        
    Returns:
        List of alternatives, where each alternative is a list of (quantity, name, object, cost) tuples
    """
    result = []
    
    for alternative in recipe.materials:
        alternative_materials = []
        for qty, material_obj in alternative:
            if material_obj and hasattr(material_obj, 'name'):
                cost = qty * material_obj.value if hasattr(material_obj, 'value') else None
                alternative_materials.append((qty, material_obj.name, material_obj, cost))
            else:
                alternative_materials.append((qty, "Unknown", None, None))
        result.append(alternative_materials)
    
    return result


def print_recipe_materials(recipe, show_values: bool = True, show_alternatives: bool = True):
    """
    Pretty print recipe materials with their status.
    
    Args:
        recipe: Recipe object
        show_values: Whether to show coin values
        show_alternatives: Whether to show all alternative material options
    """
    print(f"\nMaterials for {recipe.name}:")
    print("-" * 60)
    
    if show_alternatives and len(recipe.materials) > 1:
        # Show all alternatives
        all_alternatives = get_all_material_alternatives(recipe)
        
        for alt_idx, alternative_materials in enumerate(all_alternatives):
            print(f"\n  Alternative {alt_idx + 1}:")
            alt_total = 0
            for qty, material_name, obj, cost in alternative_materials:
                if obj:
                    if show_values and cost is not None:
                        print(f"    • {qty}x {material_name} ({cost} coins)")
                        alt_total += cost
                    else:
                        print(f"    • {qty}x {material_name}")
                else:
                    print(f"    • {qty}x {material_name} (NOT FOUND)")
            
            if show_values and alt_total > 0:
                print(f"    Total: {alt_total} coins")
        
        # Show selected alternative cost
        selected_cost = calculate_material_cost(recipe, prefer_cheapest=True)
        if selected_cost is not None and show_values:
            print(f"\nSelected alternative (cheapest): {selected_cost} coins")
    else:
        # Show selected materials only (single alternative or no alternatives to show)
        total_value = 0
        all_found = True
        
        for qty, material_name, obj in get_recipe_materials_with_objects(recipe):
            if obj:
                status = "✓"
                if hasattr(obj, 'value'):
                    value = obj.value * qty
                    total_value += value
                    if show_values:
                        print(f"  {status} {qty}x {material_name} ({value} coins)")
                    else:
                        print(f"  {status} {qty}x {material_name}")
                else:
                    print(f"  {status} {qty}x {material_name} (no value)")
            else:
                status = "✗"
                all_found = False
                print(f"  {status} {qty}x {material_name} (NOT FOUND)")
        
        if show_values and all_found:
            print(f"\nTotal material cost: {total_value} coins")
        elif not all_found:
            print(f"\n⚠ Some materials could not be resolved")


if __name__ == '__main__':
    # Test the material resolution
    # RECIPES_BY_NAME already imported from walkscape_constants
    
    print("Testing Material Resolution")
    print("=" * 60)
    
    # Test a few recipes
    test_recipes = ["Birch Plank", "Copper Bar", "Iron Sickle", "Wooden Shield"]
    
    for recipe_name in test_recipes:
        if recipe_name in RECIPES_BY_NAME:
            recipe = RECIPES_BY_NAME[recipe_name]
            print_recipe_materials(recipe)
    
    # Summary
    print("\n" + "=" * 60)
    print("Validation Summary")
    print("=" * 60)
    
    total_recipes = len(RECIPES_BY_NAME)
    recipes_with_issues = 0
    total_materials = 0
    missing_materials = set()
    
    for recipe in RECIPES_BY_NAME.values():
        found, missing = validate_recipe_materials(recipe)
        total_materials += len(recipe.materials)
        if missing:
            recipes_with_issues += 1
            missing_materials.update(missing)
    
    print(f"Total recipes: {total_recipes}")
    print(f"Recipes with unresolved materials: {recipes_with_issues}")
    print(f"Total material references: {total_materials}")
    print(f"Unique missing materials: {len(missing_materials)}")
    
    if missing_materials:
        print("\nMissing materials:")
        for mat in sorted(missing_materials):
            print(f"  - {mat}")
